/**
 * O CUSTO DE IA É MOSTRADO NA MOEDA QUE A INSTALAÇÃO ESCOLHEU — e o banco
 * continua em dólar.
 *
 * ─── O pedido (2026-09-21) ─────────────────────────────────────────────────
 *
 * Quem revende o agente a clientes precisa que Uso, Execuções, Evolução e o
 * orçamento falem em REAL, com margem embutida no que o cliente vê, e que o
 * admin da instalação veja o custo real ao lado. Cotação FIXA, digitada por
 * ele: sem busca de câmbio.
 *
 * ─── O que este arquivo prova ───────────────────────────────────────────────
 *
 * 1. Padrão = dólar, sem margem: nada muda para quem nunca abriu a tela.
 * 2. BRL × cotação × margem: a fórmula, nos dois sentidos, e a inversa
 *    devolve o que entrou (o teto digitado em R$ grava o USD certo).
 * 3. `normalizarExibicao` nunca lança e degrada para o padrão (numeric como
 *    string, BRL sem cotação, margem negativa).
 * 4. A formatação: "R$ 1,12", 4 casas para fração de centavo, espaço comum
 *    (não NBSP), e `formatarCustoReal` é sempre US$ sem margem.
 * 5. O texto do bloqueio da Central (`corpoDoBloqueio`) fala na moeda da
 *    instalação, e `exibicaoDaLinha` lê o jsonb de `SQL_ORCAMENTO` sem
 *    quebrar num banco anterior à 0277 (chave ausente = dólar).
 * 6. CERCA: nenhuma tela de custo formata `cost_cents` com "USD" fixo — todas
 *    passam pelo formatador da instalação. Foi assim que sete telas ficaram
 *    em US$ hardcoded (`lib/money.ts`), e é assim que voltariam.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXIBICAO_PADRAO,
  centsExibidos,
  centsUsdDe,
  exibicaoDifereDoReal,
  fatorDeExibicao,
  formatarCusto,
  formatarCustoReal,
  normalizarExibicao,
  rotuloDaMoeda,
  type ExibicaoDoCusto,
} from "@/lib/ai/custo/moeda";
import { corpoDoBloqueio, exibicaoDaLinha, SQL_ORCAMENTO } from "@/lib/agent-engine/edge/llm/orcamento";

const BRL_540_30: ExibicaoDoCusto = { moeda: "BRL", cotacao: 5.4, margemPct: 30 };

describe("moeda de exibição do custo de IA", () => {
  it("1. o padrão é dólar sem margem — fator 1, rótulo US$", () => {
    expect(fatorDeExibicao(EXIBICAO_PADRAO)).toBe(1);
    expect(rotuloDaMoeda(EXIBICAO_PADRAO)).toBe("US$");
    expect(exibicaoDifereDoReal(EXIBICAO_PADRAO)).toBe(false);
    expect(formatarCusto(1250, EXIBICAO_PADRAO)).toBe("US$ 12,50");
  });

  it("2. BRL × cotação × margem, e a inversa devolve o que entrou", () => {
    expect(fatorDeExibicao(BRL_540_30)).toBeCloseTo(5.4 * 1.3, 12);
    // US$ 12,50 → R$ 87,75 com 30% de margem.
    expect(centsExibidos(1250, BRL_540_30)).toBeCloseTo(8775, 9);
    // Quem digita R$ 87,75 de teto grava US$ 12,50.
    expect(centsUsdDe(8775, BRL_540_30)).toBe(1250);
    // Ida e volta em valores arbitrários fecha no centavo de USD.
    for (const usd of [1, 99, 100, 2500, 123456]) {
      expect(centsUsdDe(centsExibidos(usd, BRL_540_30), BRL_540_30)).toBe(usd);
    }
    expect(exibicaoDifereDoReal(BRL_540_30)).toBe(true);
    // Só margem, sem trocar moeda, também difere do real.
    expect(exibicaoDifereDoReal({ moeda: "USD", cotacao: null, margemPct: 10 })).toBe(true);
  });

  it("3. normalizar nunca lança e degrada para o padrão", () => {
    // `numeric` do Postgres chega como string.
    expect(normalizarExibicao({ moeda: "BRL", cotacao: "5.4000", margemPct: "30.00" })).toEqual(BRL_540_30);
    // BRL sem cotação (ou com cotação torta) → dólar, mantendo a margem válida.
    expect(normalizarExibicao({ moeda: "BRL", cotacao: null, margemPct: 10 })).toEqual({
      moeda: "USD",
      cotacao: null,
      margemPct: 10,
    });
    expect(normalizarExibicao({ moeda: "BRL", cotacao: "abc", margemPct: 0 })).toEqual(EXIBICAO_PADRAO);
    expect(normalizarExibicao({ moeda: "BRL", cotacao: 0, margemPct: 0 })).toEqual(EXIBICAO_PADRAO);
    // Margem negativa ou absurda → 0.
    expect(normalizarExibicao({ moeda: "USD", margemPct: -5 }).margemPct).toBe(0);
    expect(normalizarExibicao({ moeda: "USD", margemPct: 5000 }).margemPct).toBe(0);
    // Moeda desconhecida → dólar.
    expect(normalizarExibicao({ moeda: "EUR", cotacao: 6 })).toEqual(EXIBICAO_PADRAO);
    expect(normalizarExibicao({})).toEqual(EXIBICAO_PADRAO);
  });

  it("4. formata em pt-BR, com espaço comum, 4 casas para fração de centavo", () => {
    expect(formatarCusto(1250, BRL_540_30)).toBe("R$ 87,75");
    // A execução real de 41,8s (US$ 0,0021) em R$ com margem: 0,2093 × 7,02 = 1,469¢.
    expect(formatarCusto(0.2093, BRL_540_30, { casas: 4 })).toBe("R$ 0,0147");
    // 2 casas mostraria o zero que não é zero.
    expect(formatarCusto(0.2093, EXIBICAO_PADRAO)).toBe("US$ 0,00");
    expect(formatarCusto(0.2093, EXIBICAO_PADRAO, { casas: 4 })).toBe("US$ 0,0021");
    // Nunca NBSP entre símbolo e número.
    expect(formatarCusto(1, BRL_540_30)).not.toMatch(/ /);
    // O custo real ignora a configuração: é o que o provedor cobrou.
    expect(formatarCustoReal(1250)).toBe("US$ 12,50");
    expect(formatarCusto(null, BRL_540_30)).toBe("R$ 0,00");
  });

  it("5. o aviso da Central fala na moeda da instalação, e lê o jsonb sem quebrar", () => {
    expect(corpoDoBloqueio(2000, 2500)).toContain("US$ 20,00 de um limite de US$ 25,00 (80%)");
    expect(corpoDoBloqueio(2000, 2500, BRL_540_30)).toContain("R$ 140,40 de um limite de R$ 175,50 (80%)");
    // `to_jsonb(ps)` da linha inteira: chaves extras não atrapalham, ausentes = dólar.
    expect(exibicaoDaLinha({ id: 1, signup_mode: "aberto" })).toEqual(EXIBICAO_PADRAO);
    expect(exibicaoDaLinha(null)).toEqual(EXIBICAO_PADRAO);
    expect(
      exibicaoDaLinha({ id: 1, ai_cost_currency: "BRL", ai_cost_fx_rate: "5.4000", ai_cost_markup_pct: "30.00" }),
    ).toEqual(BRL_540_30);
    // O statement devolve a coluna, e a lê por to_jsonb (tolerante a banco velho).
    expect(SQL_ORCAMENTO).toMatch(/to_jsonb\(ps\)/);
    expect(SQL_ORCAMENTO).toMatch(/as exibicao;/);
    expect(SQL_ORCAMENTO).not.toMatch(/ps\.ai_cost_currency/);
  });

  it("6. CERCA: nenhuma tela de custo formata cost_cents com USD fixo", () => {
    const telas = [
      "app/app/ai/runs/_components/ExecucoesDeIa.tsx",
      "app/app/ai/agents/[id]/_components/RunsTable.tsx",
      "app/app/ai/agents/[id]/_components/RunDetailDrawer.tsx",
      "app/app/ai/agents/[id]/_components/TestPanel.tsx",
      "app/app/ai/evolution/_client.tsx",
      "app/app/ai/usage/_client.tsx",
      "components/ai/UsageChart.tsx",
      "components/ai/BudgetCard.tsx",
      "components/admin/tenants/HealthGrid.tsx",
      "components/admin/usage/UsageCharts.tsx",
      "components/admin/usage/UsageTable.tsx",
    ];
    for (const tela of telas) {
      const src = readFileSync(join(process.cwd(), tela), "utf8");
      expect(src, `${tela}: formata custo com USD fixo em vez do formatador da instalação`).not.toMatch(
        /currency:\s*["']USD["']|formatCentsUSD|`US\$ \$\{/,
      );
      expect(src, `${tela}: não usa useFormatadorDeCusto`).toMatch(/useFormatadorDeCusto/);
    }
  });
});
