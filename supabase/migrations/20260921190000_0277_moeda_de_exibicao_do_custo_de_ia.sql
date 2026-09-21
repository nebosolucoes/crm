-- 0277 — moeda de EXIBIÇÃO do custo de IA, com cotação fixa e margem.
--
-- ## O pedido
--
-- Quem instala o produto para revender o agente a clientes precisa que Uso,
-- Execuções, Evolução e o orçamento falem em REAL — e quer embutir margem no
-- que mostra ao cliente, vendo também o custo real. Hoje tudo é "US$", porque
-- o provedor cobra em dólar e `cost_cents` é centavo de dólar (`lib/money.ts`
-- explica por que sete telas foram CORRIGIDAS para US$: formatar o número em
-- R$ sem converter mentia por ~5×).
--
-- ## A decisão
--
-- O banco CONTINUA em USD (custo, teto, gate de orçamento no SQL — nada disso
-- muda). O que entra é a configuração da instalação, na linha única de
-- `platform_settings`:
--
--   ai_cost_currency    'USD' (padrão, comportamento de sempre) | 'BRL'
--   ai_cost_fx_rate     reais por dólar — FIXA, digitada pelo admin. Sem busca
--                       de câmbio: o self-host não ganha dependência externa
--                       por um rótulo, e quem revende quer controlar o número.
--   ai_cost_markup_pct  margem sobre o custo, em %. 0 = só converter.
--
-- exibido = usd × cotação × (1 + margem/100). O teto digitado em R$ é gravado
-- em USD pela inversa. Regra pura em `lib/ai/custo/moeda.ts`; leitura no
-- servidor em `lib/ai/custo/exibicao-da-instalacao.ts`; o worker lê as três
-- colunas no CTE de `SQL_ORCAMENTO` para escrever o aviso da Central na moeda
-- que a pessoa vê.
--
-- Idempotente: `add column if not exists` e CHECKs guardados por `do` block.
-- Instalação existente fica em USD, sem nada mudar até alguém abrir
-- /admin/custo-de-ia.

alter table public.platform_settings
  add column if not exists ai_cost_currency   text          not null default 'USD',
  add column if not exists ai_cost_fx_rate    numeric(12,4),
  add column if not exists ai_cost_markup_pct numeric(6,2)  not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.platform_settings'::regclass
       and conname = 'platform_settings_ai_cost_currency'
  ) then
    alter table public.platform_settings
      add constraint platform_settings_ai_cost_currency
      check (ai_cost_currency in ('USD', 'BRL'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.platform_settings'::regclass
       and conname = 'platform_settings_ai_cost_fx_rate'
  ) then
    alter table public.platform_settings
      add constraint platform_settings_ai_cost_fx_rate
      check (ai_cost_fx_rate is null or ai_cost_fx_rate > 0);
  end if;

  -- BRL sem cotação seria uma exibição que não sabe converter. O padrão USD
  -- não exige nada.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.platform_settings'::regclass
       and conname = 'platform_settings_ai_cost_brl_exige_cotacao'
  ) then
    alter table public.platform_settings
      add constraint platform_settings_ai_cost_brl_exige_cotacao
      check (ai_cost_currency = 'USD' or ai_cost_fx_rate is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.platform_settings'::regclass
       and conname = 'platform_settings_ai_cost_markup_pct'
  ) then
    alter table public.platform_settings
      add constraint platform_settings_ai_cost_markup_pct
      check (ai_cost_markup_pct >= 0 and ai_cost_markup_pct <= 1000);
  end if;
end $$;

comment on column public.platform_settings.ai_cost_currency is
  'Moeda em que o custo de IA é MOSTRADO (USD = como o provedor cobra; BRL = convertido pela cotação fixa). O banco guarda sempre centavos de USD. Ver lib/ai/custo/moeda.ts.';
comment on column public.platform_settings.ai_cost_fx_rate is
  'Reais por dólar, fixa, digitada pelo admin da instalação. Obrigatória quando ai_cost_currency = BRL.';
comment on column public.platform_settings.ai_cost_markup_pct is
  'Margem (%) aplicada sobre o custo de IA em toda tela de organização; o admin da instalação vê também o custo real. 0 = só converter.';
