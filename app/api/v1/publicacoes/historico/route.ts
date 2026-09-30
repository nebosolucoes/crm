/**
 * GET /api/v1/publicacoes/historico — só o que saiu do fluxo pendente
 * (concluído, parcial, falhou, pulado, cancelado), do mais recente para o mais
 * antigo, com cursor opaco. Cada item traz o placar por destino; o detalhe com
 * o erro de cada execução está em `/ocorrencias/[id]`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { filtrosDoHistoricoSchema } from "@/lib/publicacoes/schema";
import { historicoDeOcorrencias } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

import { responderErro, responderValidacao } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "publication_occurrences" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = filtrosDoHistoricoSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);

  try {
    const pagina = await historicoDeOcorrencias(createAdminClient(), authz.org.orgId, parsed.data);
    return ok(pagina.itens, { requestId, meta: { cursor: pagina.cursor ?? undefined, has_more: pagina.has_more } });
  } catch (err) {
    return responderErro(err, requestId, t, "histórico");
  }
}
