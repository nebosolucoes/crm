/**
 * GET /api/v1/publicacoes/ocorrencias?de=&ate=&incluir= — as ocorrências num
 * intervalo de INSTANTES (nunca `dia=`, que corta em UTC), já resumidas para a
 * Lista e o Calendário: título, miniatura, destinos com contagem de grupos e
 * o placar das execuções. Por padrão só pendentes; `incluir=todas` traz o que
 * já saiu, para o calendário mostrar o passado do mês.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { filtrosDeOcorrenciasSchema } from "@/lib/publicacoes/schema";
import { listarOcorrencias } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

import { responderErro, responderValidacao } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "publication_occurrences" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = filtrosDeOcorrenciasSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);

  try {
    const itens = await listarOcorrencias(createAdminClient(), authz.org.orgId, parsed.data);
    return ok(itens, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "listar ocorrências");
  }
}
