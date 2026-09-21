/**
 * O CUSTO DE UMA CHAMADA DE IA EXISTE PARA TODO MODELO DO CATÁLOGO.
 *
 * ─── O defeito, medido no banco local (2026-09-21) ─────────────────────────
 *
 * `lib/agent-engine/edge/llm/pricing.ts` era uma tabela fixa de três prefixos
 * da Anthropic direta. Todo modelo fora dela — qualquer id via OpenRouter
 * (`openai/gpt-5-nano`, `qwen/qwen3.7-flash`, e até `anthropic/claude-haiku-4.5`
 * por causa do `anthropic/`) — gravava `llm_calls.cost_cents = NULL`: 15 de 15
 * chamadas do dia, com o preço dos mesmos modelos em `ai_models` (438 de 443
 * linhas do OpenRouter com preço). A tela de Execuções mostrava "—", e o teto
 * de orçamento (`coalesce(cost_cents, 0)`) nunca era consumido.
 *
 * ─── O que este arquivo prova ───────────────────────────────────────────────
 *
 * 1. Modelo do catálogo → custo calculado pelo preço do catálogo (o caso que
 *    era NULL).
 * 2. Modelo fora do catálogo mas na tabela fixa → tabela fixa (o comportamento
 *    antigo continua).
 * 3. Modelo em lugar nenhum → `null`, nunca 0 (0 seria afirmar "de graça").
 * 4. Catálogo inacessível → não lança; cai na tabela fixa.
 * 5. O catálogo é lido UMA vez por janela de cache, não uma por chamada.
 * 6. A fórmula do TypeScript e a do backfill SQL (migration 0276) dão o mesmo
 *    número para o mesmo usage — senão o histórico e o futuro discordam.
 * 7. `run-model-call.ts` grava pelo catálogo (cerca estrutural).
 *
 * A sabotagem prevista: voltar `run-model-call.ts` para `costCents(model, usage)`
 * derruba o caso 7; tirar o catálogo de `precoDoModelo` derruba 1, 2b e 5.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCacheDePrecosParaTestes,
  calcularCustoCents,
  costCents,
  custoEmCents,
  precoDoModelo,
  RAZAO_CACHE_READ,
  RAZAO_CACHE_WRITE_1H,
} from "@/lib/agent-engine/edge/llm/pricing";

/** Linhas como `ai_models` devolve: preço em CENTAVOS por milhão; numeric chega como string. */
const CATALOGO = [
  { provider: "openrouter", model_id: "openai/gpt-5-nano", input_price_per_million_cents: "5", output_price_per_million_cents: "40" },
  { provider: "openrouter", model_id: "qwen/qwen3.7-flash", input_price_per_million_cents: 3, output_price_per_million_cents: 13 },
  { provider: "anthropic", model_id: "claude-sonnet-5", input_price_per_million_cents: 200, output_price_per_million_cents: 1000 },
  // Metade de um preço não é preço.
  { provider: "openrouter", model_id: "x/sem-saida", input_price_per_million_cents: 5, output_price_per_million_cents: null },
];

function dbCom(rows: unknown[] | Error) {
  const query = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return { rows, rowCount: rows.length };
  });
  return { db: { query } as unknown as Parameters<typeof precoDoModelo>[0], query };
}

/** A chamada real de 41,8s medida no banco: gpt-5-nano via OpenRouter. */
const USAGE_REAL = { inputTokens: 27862, outputTokens: 3809, cacheReadTokens: 18304, cacheWriteTokens: 0 };

beforeEach(() => {
  _resetCacheDePrecosParaTestes();
});

describe("custo pelo catálogo ai_models", () => {
  it("1. modelo via OpenRouter tem custo — o caso que gravava NULL", async () => {
    const { db } = dbCom(CATALOGO);
    const custo = await custoEmCents(db, "openrouter", "openai/gpt-5-nano", USAGE_REAL);
    // 9.558 novos × 5¢/M + 18.304 cache × 0,5¢/M + 3.809 saída × 40¢/M ≈ 0,209¢
    const esperado = (9558 * 5 + 18304 * 5 * RAZAO_CACHE_READ + 3809 * 40) / 1_000_000;
    expect(custo).not.toBeNull();
    expect(custo!).toBeCloseTo(esperado, 9);
    expect(custo!).toBeGreaterThan(0);
  });

  it("1b. a chave é (provider, model_id): o mesmo id noutro provider não pega o preço", async () => {
    const { db } = dbCom(CATALOGO);
    expect(await precoDoModelo(db, "openai", "openai/gpt-5-nano")).toBeNull();
  });

  it("2. fora do catálogo mas na tabela fixa → tabela fixa (comportamento antigo intacto)", async () => {
    const { db } = dbCom(CATALOGO);
    const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(await custoEmCents(db, "anthropic", "claude-haiku-4-5-20251001", usage)).toBe(
      costCents("claude-haiku-4-5-20251001", usage),
    );
  });

  it("2b. o catálogo vence a tabela fixa quando os dois têm o modelo", async () => {
    const { db } = dbCom([
      { provider: "anthropic", model_id: "claude-sonnet-4-6", input_price_per_million_cents: 100, output_price_per_million_cents: 100 },
    ]);
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    // A tabela fixa diria 300¢ (US$ 3/M); o catálogo diz 100¢.
    expect(await custoEmCents(db, "anthropic", "claude-sonnet-4-6", usage)).toBeCloseTo(100, 9);
  });

  it("3. em lugar nenhum → null, nunca 0", async () => {
    const { db } = dbCom(CATALOGO);
    expect(await custoEmCents(db, "openrouter", "vendor/inexistente", USAGE_REAL)).toBeNull();
    expect(await custoEmCents(db, "openrouter", "x/sem-saida", USAGE_REAL)).toBeNull();
  });

  it("4. catálogo inacessível não lança e cai na tabela fixa", async () => {
    const { db } = dbCom(new Error('relation "ai_models" does not exist'));
    const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    await expect(custoEmCents(db, "openrouter", "openai/gpt-5-nano", usage)).resolves.toBeNull();
    await expect(custoEmCents(db, "anthropic", "claude-sonnet-4-6", usage)).resolves.toBe(
      costCents("claude-sonnet-4-6", usage),
    );
  });

  it("5. o catálogo é lido uma vez por janela de cache", async () => {
    const { db, query } = dbCom(CATALOGO);
    await custoEmCents(db, "openrouter", "openai/gpt-5-nano", USAGE_REAL);
    await custoEmCents(db, "openrouter", "qwen/qwen3.7-flash", USAGE_REAL);
    await custoEmCents(db, "anthropic", "claude-sonnet-5", USAGE_REAL);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("6. a fórmula do código e a do backfill SQL (0276) são a mesma", () => {
    const usage = { inputTokens: 27862, outputTokens: 3809, cacheReadTokens: 18304, cacheWriteTokens: 1000 };
    const inCents = 5;
    const outCents = 40;
    // O SQL da migration, transcrito: preço em centavos/M, resultado em centavos.
    const sql =
      (Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens) * inCents +
        usage.cacheReadTokens * inCents * 0.1 +
        usage.cacheWriteTokens * inCents * 2 +
        usage.outputTokens * outCents) /
      1_000_000;
    const ts = calcularCustoCents(
      {
        input: inCents / 100,
        output: outCents / 100,
        cacheRead: (inCents / 100) * RAZAO_CACHE_READ,
        cacheWrite1h: (inCents / 100) * RAZAO_CACHE_WRITE_1H,
      },
      usage,
    );
    expect(ts).toBeCloseTo(sql, 12);
    // E as razões que o SQL fixa por número são as que o código exporta.
    expect(RAZAO_CACHE_READ).toBe(0.1);
    expect(RAZAO_CACHE_WRITE_1H).toBe(2);
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260921180000_0276_custo_das_chamadas_pelo_catalogo.sql"),
      "utf8",
    );
    expect(migration).toMatch(/input_price_per_million_cents \* 0\.1/);
    expect(migration).toMatch(/input_price_per_million_cents \* 2/);
    expect(migration).toMatch(/where c\.cost_cents is null/);
  });

  it("7. run-model-call grava pelo catálogo, não pela tabela fixa", () => {
    const src = readFileSync(join(process.cwd(), "lib/agent-engine/edge/llm/run-model-call.ts"), "utf8");
    expect(src).toMatch(/await custoEmCents\(db, config\.provider, model, usage\)/);
    expect(src).not.toMatch(/\bcostCents\(model, usage\)/);
  });
});
