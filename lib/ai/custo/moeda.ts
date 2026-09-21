/**
 * Moeda de EXIBIÇÃO do custo de IA — o que a pessoa lê, por cima do que o banco
 * guarda.
 *
 * ## O que o banco guarda, e por que isso não muda
 *
 * `llm_calls.cost_cents`, `ai_invocations.cost_cents` e `ai_budgets.monthly_limit_cents`
 * são centavos de DÓLAR: o provedor cobra em USD, o catálogo (`ai_models`)
 * publica USD, e o gate de orçamento compara gasto e teto no SQL, na mesma
 * unidade. Trocar a unidade gravada exigiria reescrever histórico a cada
 * mudança de cotação. Fica em USD; o que muda é a leitura.
 *
 * ## O que a instalação decide (`platform_settings`)
 *
 * - `ai_cost_currency`: `USD` (o padrão de sempre) ou `BRL`.
 * - `ai_cost_fx_rate`: reais por dólar. Fixa, digitada por quem administra a
 *   instalação — não há busca de câmbio: o self-host não ganha uma dependência
 *   externa nova por um rótulo, e quem revende quer CONTROLAR o número, não
 *   segui-lo.
 * - `ai_cost_markup_pct`: margem sobre o custo, em %. Quem fornece o agente a
 *   um cliente mostra a ele o valor COM margem; o admin da instalação vê os
 *   dois (custo real e valor repassado).
 *
 * ## Uma fórmula, nos dois sentidos
 *
 *   exibido = usd × cotação × (1 + margem/100)        (cotação = 1 em USD)
 *
 * O teto de orçamento é digitado na moeda exibida e gravado em USD pela
 * INVERSA da mesma fórmula, para que "parar em R$ 100" seja comparado com o
 * gasto na MESMA régua que a tela mostra. Se a cotação muda depois, o teto em
 * R$ que a tela mostra muda junto — é o preço de não guardar duas moedas, e é
 * o comportamento certo: o teto é sobre dólares gastos, e a tela é honesta
 * sobre quantos reais isso vale hoje.
 *
 * Este módulo é PURO e isomórfico: roda no browser, no servidor e no worker
 * (`pg`). Quem lê a configuração do banco é `exibicao-da-instalacao.ts`
 * (servidor) e o CTE de `SQL_ORCAMENTO` (worker).
 */

export const MOEDAS_DO_CUSTO = ["USD", "BRL"] as const;
export type MoedaDoCusto = (typeof MOEDAS_DO_CUSTO)[number];

export interface ExibicaoDoCusto {
  moeda: MoedaDoCusto;
  /** Reais por dólar. Só faz sentido (e é exigido pelo CHECK) em BRL. */
  cotacao: number | null;
  /** Margem sobre o custo, em %. 0 = só converter. */
  margemPct: number;
}

/** Sem linha em `platform_settings`, sem banco, sem provider: dólar, como sempre foi. */
export const EXIBICAO_PADRAO: ExibicaoDoCusto = Object.freeze({
  moeda: "USD",
  cotacao: null,
  margemPct: 0,
}) as ExibicaoDoCusto;

/** Limites que o CHECK do banco também aplica — a tela recusa antes, com motivo. */
export const COTACAO_MIN = 0.0001;
export const MARGEM_MAX_PCT = 1000;

export function ehMoedaDoCusto(v: unknown): v is MoedaDoCusto {
  return typeof v === "string" && (MOEDAS_DO_CUSTO as readonly string[]).includes(v);
}

/**
 * Normaliza o que veio do banco/JSON para uma configuração VÁLIDA, degradando
 * para o padrão em vez de lançar: um `numeric` que chega como string, uma
 * cotação nula em BRL (impossível pelo CHECK, mas a leitura não confia), uma
 * margem negativa — tudo vira o padrão ou o valor saneado. Custo não pode ser
 * o motivo de tela nenhuma quebrar.
 */
export function normalizarExibicao(bruto: {
  moeda?: unknown;
  cotacao?: unknown;
  margemPct?: unknown;
}): ExibicaoDoCusto {
  const margem = Number(bruto.margemPct ?? 0);
  const margemPct = Number.isFinite(margem) && margem >= 0 && margem <= MARGEM_MAX_PCT ? margem : 0;
  if (bruto.moeda !== "BRL") return { moeda: "USD", cotacao: null, margemPct };
  const cotacao = Number(bruto.cotacao);
  if (!Number.isFinite(cotacao) || cotacao < COTACAO_MIN) return { ...EXIBICAO_PADRAO, margemPct };
  return { moeda: "BRL", cotacao, margemPct };
}

/** USD → moeda exibida, com margem. É o número que multiplica centavos de USD. */
export function fatorDeExibicao(cfg: ExibicaoDoCusto): number {
  const cambio = cfg.moeda === "BRL" && cfg.cotacao !== null ? cfg.cotacao : 1;
  return cambio * (1 + cfg.margemPct / 100);
}

/** Centavos de USD → centavos na moeda exibida (fracionário; quem mostra arredonda). */
export function centsExibidos(usdCents: number, cfg: ExibicaoDoCusto): number {
  return usdCents * fatorDeExibicao(cfg);
}

/** Centavos na moeda exibida → centavos de USD, inteiro (é o que o banco guarda). */
export function centsUsdDe(centsExibidos: number, cfg: ExibicaoDoCusto): number {
  return Math.round(centsExibidos / fatorDeExibicao(cfg));
}

export function rotuloDaMoeda(cfg: ExibicaoDoCusto): "R$" | "US$" {
  return cfg.moeda === "BRL" ? "R$" : "US$";
}

/**
 * Centavos de USD → "R$ 0,0021" / "US$ 12,50". `casas: 4` para uma execução
 * isolada (fração de centavo; 2 casas mostraria "R$ 0,00" para todas — o zero
 * que não é zero); `casas: 2` para somas e tetos.
 *
 * `pt-BR` fixo: a moeda é fato da instalação e o separador acompanha a moeda,
 * não o idioma de quem lê — mesma decisão de `formatCents` em `lib/money.ts`.
 */
export function formatarCusto(
  usdCents: number | null | undefined,
  cfg: ExibicaoDoCusto,
  opts: { casas?: 2 | 4 } = {},
): string {
  const casas = opts.casas ?? 2;
  const valor = centsExibidos(Number(usdCents ?? 0), cfg) / 100;
  return (
    valor
      .toLocaleString("pt-BR", {
        style: "currency",
        currency: cfg.moeda,
        minimumFractionDigits: casas,
        maximumFractionDigits: casas,
      })
      // O `Intl` separa símbolo e número com NBSP (U+00A0). Espaço comum: é o
      // que o texto dos avisos da Central e da API sempre escreveu ("US$ 1,00"),
      // e o que um `contains` num teste ou um copiar-colar do usuário esperam.
      .replace(/\u00a0/g, " ")
  );
}

/**
 * O custo REAL, sem margem e em dólar — o que o admin da instalação vê ao lado
 * do valor repassado. Sempre USD, porque é o que o provedor cobrou.
 */
export function formatarCustoReal(usdCents: number | null | undefined, opts: { casas?: 2 | 4 } = {}): string {
  return formatarCusto(usdCents, EXIBICAO_PADRAO, opts);
}

/** A instalação mostra algo DIFERENTE do custo real (moeda ou margem)? */
export function exibicaoDifereDoReal(cfg: ExibicaoDoCusto): boolean {
  return cfg.moeda !== "USD" || cfg.margemPct !== 0;
}
