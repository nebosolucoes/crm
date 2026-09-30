/**
 * POST /api/v1/publicacoes/ocorrencias/[id]/cancelar — cancela SÓ esta
 * ocorrência. As outras datas da mesma publicação seguem; se era a última
 * pendente e a recorrência acabou, a publicação fecha.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { cancelarOcorrencia } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

import { responderErro } from "../../../_comum";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_occurrences" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  try {
    const ocorrencia = await cancelarOcorrencia(createAdminClient(), { orgId: authz.org.orgId, userId: authz.user.id }, id);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.occurrence_cancelled",
      resourceType: "publication_occurrences",
      resourceId: id,
      requestId,
    });
    return ok(ocorrencia, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "cancelar ocorrência");
  }
}
