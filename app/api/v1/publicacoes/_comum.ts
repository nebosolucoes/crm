/**
 * O que toda rota de Publicações repete: traduzir o erro do domínio em HTTP e
 * ler o corpo. O `requireRole({ feature: "broadcast" })` fica em CADA rota de
 * propósito — `tests/unit/rotas-declaram-recurso.test.ts` lê o literal no
 * arquivo, e um helper que o escondesse deixaria a cerca cega.
 */
import type { ZodError } from "zod";

import { fail } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { ErroDePublicacao } from "@/lib/publicacoes/servico";

export type Traduz = (texto: string) => string;

export function responderErro(err: unknown, requestId: string, t: Traduz, contexto: string): Response {
  if (err instanceof ErroDePublicacao) {
    return fail(err.codigo, t(err.message), err.status, { requestId, details: err.details });
  }
  logger.error(`[publicacoes] ${contexto} falhou`, { requestId, cause: err instanceof Error ? err.message : String(err) });
  return fail("internal_error", t("Não foi possível concluir. Tente de novo."), 500, { requestId });
}

export function responderValidacao(erro: ZodError, requestId: string, t: Traduz): Response {
  return fail("validation_failed", t("Dados inválidos."), 422, {
    requestId,
    details: erro.flatten().fieldErrors as Record<string, unknown>,
  });
}

export async function lerCorpo(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
