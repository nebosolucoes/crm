-- 0276 — custo das chamadas de IA recalculado pelo catálogo de modelos.
--
-- ## O defeito
--
-- O motor vivo (`lib/agent-engine/edge/llm/pricing.ts`) só conhecia o preço de
-- três prefixos da Anthropic direta. Todo modelo fora deles — qualquer id via
-- OpenRouter (`openai/…`, `qwen/…`, `anthropic/claude-haiku-4.5`) e os ids
-- diretos novos (`claude-sonnet-5`) — gravava `llm_calls.cost_cents = NULL`,
-- com o preço do MESMO modelo sentado em `ai_models` (o catálogo que o sync do
-- OpenRouter mantém). Medido em 2026-09-21: 15 de 15 chamadas do dia nulas.
--
-- Efeitos: a tela de Execuções/Uso mostra "—"; a evolução soma zero; e o teto
-- de orçamento da organização — `coalesce(cost_cents, 0)` — nunca é consumido
-- por uso via OpenRouter. Para quem revende o agente a um cliente, o custo que
-- precisa repassar simplesmente não existe.
--
-- ## O que esta migration faz
--
-- O código passou a consultar `ai_models` na hora da gravação. Esta migration
-- cuida do HISTÓRICO: recalcula `cost_cents` das linhas em que ele é nulo, a
-- partir dos tokens que sempre foram gravados e do preço do catálogo, com a
-- mesma fórmula do código:
--
--   (entrada não cacheada × preço_in
--    + cache read  × preço_in × 0,1
--    + cache write × preço_in × 2        -- tarifa do TTL de 1h (regra 15)
--    + saída       × preço_out) / 1.000.000
--
-- Preço do catálogo está em CENTAVOS por milhão, então o resultado já sai em
-- centavos. Só `status = 'ok'` (falha não gasta) e só linha com `cost_cents`
-- nulo e modelo com os DOIS preços conhecidos: metade de um preço é um custo
-- falso, e linha já custeada não é reescrita. Idempotente: a segunda aplicação
-- não encontra linha para tocar.
--
-- Sem coluna, função ou constraint nova. Genérica: sem id de organização, sem
-- modelo fixo — o que houver no catálogo do clone é o que precifica.

update public.llm_calls c
   set cost_cents = (
         greatest(0, c.input_tokens - c.cache_read_tokens - c.cache_write_tokens)
           * m.input_price_per_million_cents
         + c.cache_read_tokens  * m.input_price_per_million_cents * 0.1
         + c.cache_write_tokens * m.input_price_per_million_cents * 2
         + c.output_tokens      * m.output_price_per_million_cents
       )::numeric / 1000000
  from public.ai_models m
 where c.cost_cents is null
   and c.status = 'ok'
   and m.provider = c.provider
   and m.model_id = c.model
   and m.input_price_per_million_cents  is not null
   and m.output_price_per_million_cents is not null;
