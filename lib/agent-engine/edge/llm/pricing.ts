/**
 * Preço de modelo → `llm_calls.cost_cents` (stack.md §2: usage × preço).
 * ÚNICO lugar do motor vivo que sabe converter tokens em dinheiro.
 *
 * ## De onde vem o preço (nesta ordem)
 *
 * 1. **Catálogo `ai_models`**, por `(provider, model_id)` exato. É a tabela que o
 *    painel de provedores lista, que `validarBinding` confere e que o sync do
 *    OpenRouter (`lib/ai/catalogo/sincronizar.ts`) mantém com preço por milhão.
 *    Carregada inteira uma vez e guardada em memória por 5 min — ~500 linhas,
 *    e a chamada ao modelo já custou segundos; uma leitura a cada 5 min não
 *    aparece em lugar nenhum.
 * 2. **Tabela fixa** abaixo, por prefixo do id — só Anthropic direto. É o que
 *    existia antes, e continua valendo para banco sem catálogo (teste, clone
 *    antigo, sync que nunca rodou).
 *
 * ## Por que o catálogo entrou
 *
 * Até aqui só a tabela fixa existia, com três prefixos (`claude-sonnet-4`,
 * `claude-haiku-4`, `claude-opus-4`). Todo modelo fora dela — **qualquer id do
 * OpenRouter** (`openai/…`, `qwen/…`, e até `anthropic/claude-haiku-4.5`, por
 * causa do `anthropic/`) e os ids diretos novos (`claude-sonnet-5`) — gravava
 * `cost_cents = NULL`. Medido no banco local em 2026-09-21: 15 de 15 chamadas
 * do dia com custo nulo, com o preço dos mesmos modelos sentado em `ai_models`
 * (438 de 443 linhas do OpenRouter com preço). Três efeitos, o terceiro o pior:
 * a tela de Execuções/Uso mostra "—"; a evolução soma zero; e o TETO DE
 * ORÇAMENTO da organização — que soma `coalesce(cost_cents, 0)` — nunca é
 * consumido por uso via OpenRouter, ou seja, não existe para quem revende o
 * agente a um cliente.
 *
 * ## Cache de prompt
 *
 * O catálogo só tem preço de entrada e saída. Cache read é cobrado a 0,1× a
 * entrada (a tarifa da Anthropic e da OpenAI); cache write a 2× a entrada —
 * a tarifa do TTL de 1h que a doutrina de caching adota (CLAUDE.md regra 15).
 * Provedor que não cobra escrita de cache também não a REPORTA (o SDK devolve
 * `cacheWriteTokens = 0` na via OpenAI-compatível), então o 2× só morde onde
 * é a tarifa real. Errar para cima é a escolha: `lib/ai/cost.ts` já arredonda
 * para cima pelo mesmo motivo — cobrar de menos é dar uso de graça.
 *
 * Modelo sem preço em lugar nenhum → `null` (desconhecido): mais honesto que
 * inventar 0. O orçamento soma `coalesce(cost_cents, 0)`, então modelo sem
 * preço não consome teto — e é por isso que ter o catálogo aqui importa.
 */
import type pg from 'pg';

/** USD por MILHÃO de tokens. */
export interface PrecoDoModelo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite1h: number;
}

/**
 * Tabela fixa (fallback). Fonte: https://docs.claude.com/en/docs/about-claude/pricing
 * (conferida 2026-07); match por prefixo do id (cobre sufixo de data do vendor).
 */
const USD_PER_MTOK: Record<string, PrecoDoModelo> = {
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite1h: 6 },
  'claude-haiku-4': { input: 1, output: 5, cacheRead: 0.1, cacheWrite1h: 2 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite1h: 30 },
};

/** Razões aplicadas ao preço de ENTRADA do catálogo, que não tem tarifa de cache. */
export const RAZAO_CACHE_READ = 0.1;
export const RAZAO_CACHE_WRITE_1H = 2;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Preço da tabela fixa, por prefixo. `null` se o id não casa com nenhum. */
export function precoDaTabelaFixa(model: string): PrecoDoModelo | null {
  const priceKey = Object.keys(USD_PER_MTOK).find((prefix) => model.startsWith(prefix));
  if (priceKey === undefined) return null;
  return USD_PER_MTOK[priceKey] ?? null;
}

/**
 * Custo em CENTS (fracionário; coluna numeric) ou null sem preço. `inputTokens`
 * é o TOTAL do usage do SDK — a parcela cacheada é descontada e cobrada pela
 * tarifa de cache.
 */
export function calcularCustoCents(preco: PrecoDoModelo | null, usage: TokenUsage): number | null {
  if (preco === null) return null;
  const noCacheInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const usd =
    (noCacheInput * preco.input +
      usage.cacheReadTokens * preco.cacheRead +
      usage.cacheWriteTokens * preco.cacheWrite1h +
      usage.outputTokens * preco.output) /
    1_000_000;
  return usd * 100;
}

/** Só a tabela fixa — o comportamento antigo, mantido para quem não tem banco à mão. */
export function costCents(model: string, usage: TokenUsage): number | null {
  return calcularCustoCents(precoDaTabelaFixa(model), usage);
}

// ─── Catálogo ───────────────────────────────────────────────────────────────

interface LinhaDoCatalogo {
  provider: string;
  model_id: string;
  input_price_per_million_cents: string | number | null;
  output_price_per_million_cents: string | number | null;
}

type Db = Pick<pg.Pool, 'query'>;

const TTL_MS = 5 * 60 * 1000;
let cache: Map<string, PrecoDoModelo> | null = null;
let cacheAt = 0;

function chave(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/**
 * Preço por milhão em CENTAVOS (como o catálogo grava) → USD por milhão.
 * Linha sem um dos dois preços não entra: metade de um preço é um custo falso.
 */
function linhaParaPreco(l: LinhaDoCatalogo): PrecoDoModelo | null {
  const inCents = l.input_price_per_million_cents;
  const outCents = l.output_price_per_million_cents;
  if (inCents === null || outCents === null) return null;
  const input = Number(inCents) / 100;
  const output = Number(outCents) / 100;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return {
    input,
    output,
    cacheRead: input * RAZAO_CACHE_READ,
    cacheWrite1h: input * RAZAO_CACHE_WRITE_1H,
  };
}

async function carregarCatalogo(db: Db): Promise<Map<string, PrecoDoModelo>> {
  const agora = Date.now();
  if (cache !== null && agora - cacheAt < TTL_MS) return cache;
  let rows: LinhaDoCatalogo[];
  try {
    ({ rows } = await db.query<LinhaDoCatalogo>(
      `select provider, model_id, input_price_per_million_cents, output_price_per_million_cents
         from ai_models`,
    ));
  } catch {
    // Catálogo inacessível (banco sem a tabela, conexão caída): fica o que já
    // havia em memória, ou nada — e o fallback da tabela fixa decide. Custo
    // NUNCA derruba a chamada que ele descreve.
    return cache ?? new Map();
  }
  const mapa = new Map<string, PrecoDoModelo>();
  for (const l of rows) {
    const preco = linhaParaPreco(l);
    if (preco !== null) mapa.set(chave(l.provider, l.model_id), preco);
  }
  cache = mapa;
  cacheAt = agora;
  return mapa;
}

/** Catálogo por `(provider, model_id)` exato; senão a tabela fixa; senão `null`. */
export async function precoDoModelo(db: Db, provider: string, model: string): Promise<PrecoDoModelo | null> {
  const catalogo = await carregarCatalogo(db);
  return catalogo.get(chave(provider, model)) ?? precoDaTabelaFixa(model);
}

/** O que `run-model-call` grava em `llm_calls.cost_cents`. */
export async function custoEmCents(
  db: Db,
  provider: string,
  model: string,
  usage: TokenUsage,
): Promise<number | null> {
  return calcularCustoCents(await precoDoModelo(db, provider, model), usage);
}

/** Só testes: esvazia o cache do catálogo. */
export function _resetCacheDePrecosParaTestes(): void {
  cache = null;
  cacheAt = 0;
}
