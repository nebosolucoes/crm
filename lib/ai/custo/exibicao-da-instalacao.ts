/**
 * Leitura e escrita da moeda de exibição do custo de IA (`platform_settings`,
 * linha única) — só servidor.
 *
 * Espelha `lib/auth/politica-de-cadastro.ts`, que lê a mesma linha: memo de
 * 30 s com geração (uma leitura em voo não reinstala valor pré-escrita), último
 * valor conhecido quando o banco falha, e NUNCA lança — `branding()` e esta
 * função rodam em layout, e um throw em layout é 500 em todas as telas. Sem
 * linha, sem coluna (banco anterior à 0277), sem banco: dólar, como sempre foi.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

import {
  EXIBICAO_PADRAO,
  normalizarExibicao,
  type ExibicaoDoCusto,
} from "./moeda";

const TTL_MS = 30_000;

type Memoria = { readonly valor: ExibicaoDoCusto; readonly expiraEm: number };

declare global {
  var __memoDaExibicaoDoCusto: Memoria | undefined;
  var __ultimaExibicaoDoCustoConhecida: ExibicaoDoCusto | undefined;
  var __geracaoDaExibicaoDoCusto: number | undefined;
}

export function invalidarExibicaoDoCusto(): void {
  globalThis.__geracaoDaExibicaoDoCusto = (globalThis.__geracaoDaExibicaoDoCusto ?? 0) + 1;
  globalThis.__memoDaExibicaoDoCusto = undefined;
}

/** Só testes. */
export function esquecerExibicaoDoCusto(): void {
  globalThis.__memoDaExibicaoDoCusto = undefined;
  globalThis.__ultimaExibicaoDoCustoConhecida = undefined;
  globalThis.__geracaoDaExibicaoDoCusto = undefined;
}

const avisado = new Set<string>();
function avisarUmaVez(chave: string, contexto: Record<string, unknown>): void {
  if (avisado.has(chave)) return;
  avisado.add(chave);
  logger.warn("custo de IA: não deu para ler a moeda de exibição; vale o último valor conhecido", contexto);
}

export async function exibicaoDoCusto(): Promise<ExibicaoDoCusto> {
  const memoria = globalThis.__memoDaExibicaoDoCusto;
  if (memoria && memoria.expiraEm > Date.now()) return memoria.valor;

  const geracao = globalThis.__geracaoDaExibicaoDoCusto ?? 0;
  const lido = await ler();
  if (lido !== null) globalThis.__ultimaExibicaoDoCustoConhecida = lido;
  const valor = lido ?? globalThis.__ultimaExibicaoDoCustoConhecida ?? EXIBICAO_PADRAO;

  if ((globalThis.__geracaoDaExibicaoDoCusto ?? 0) === geracao) {
    globalThis.__memoDaExibicaoDoCusto = { valor, expiraEm: Date.now() + TTL_MS };
  }
  return valor;
}

async function ler(): Promise<ExibicaoDoCusto | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("platform_settings")
      .select("ai_cost_currency, ai_cost_fx_rate, ai_cost_markup_pct")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      // Coluna inexistente (42703) = banco anterior à 0277. É o padrão, não
      // uma falha a repetir no log a cada request.
      if (error.code !== "42703") {
        avisarUmaVez(`leitura|${error.code ?? "?"}`, { codigo: error.code, detalhe: error.message });
      }
      return EXIBICAO_PADRAO;
    }
    if (!data) return EXIBICAO_PADRAO;
    const linha = data as {
      ai_cost_currency?: unknown;
      ai_cost_fx_rate?: unknown;
      ai_cost_markup_pct?: unknown;
    };
    return normalizarExibicao({
      moeda: linha.ai_cost_currency,
      cotacao: linha.ai_cost_fx_rate,
      margemPct: linha.ai_cost_markup_pct,
    });
  } catch (erro) {
    avisarUmaVez("leitura|excecao", { detalhe: erro instanceof Error ? erro.message : String(erro) });
    return null;
  }
}

export async function gravarExibicaoDoCusto(
  cfg: ExibicaoDoCusto,
  atorUserId: string,
): Promise<boolean> {
  try {
    // `upsert`: a linha só existe depois que alguém configurou algo nela.
    // `signup_mode` tem default, então o insert de uma instalação que nunca
    // abriu /admin/cadastro não precisa dizê-lo.
    const { error } = await createAdminClient()
      .from("platform_settings")
      .upsert(
        {
          id: 1,
          ai_cost_currency: cfg.moeda,
          ai_cost_fx_rate: cfg.moeda === "BRL" ? cfg.cotacao : null,
          ai_cost_markup_pct: cfg.margemPct,
          updated_by: atorUserId,
        },
        { onConflict: "id" },
      );
    if (error) {
      logger.error("custo de IA: não deu para gravar a moeda de exibição", {
        codigo: error.code,
        detalhe: error.message,
      });
      return false;
    }
    invalidarExibicaoDoCusto();
    return true;
  } catch (erro) {
    logger.error("custo de IA: gravação da moeda de exibição falhou", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return false;
  }
}
