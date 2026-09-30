/**
 * POST /api/v1/publicacoes/execucoes/[id]/reenviar — cria a tentativa seguinte
 * de uma execução que falhou, foi pulada ou cancelada, por decisão de uma
 * pessoa. No WhatsApp é o ÚNICO reenvio que existe: o worker nunca repete
 * sozinho o que chegou a `sending` (envio em dobro é pior que não-envio).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { reenviarExecucao } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

import { responderErro } from "../../../_comum";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_executions" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  try {
    const nova = await reenviarExecucao(createAdminClient(), { orgId: authz.org.orgId, userId: authz.user.id }, id);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.execution_resent",
      resourceType: "publication_executions",
      resourceId: nova.id,
      requestId,
      metadata: { from: id, attempt: nova.attempt },
    });
    return ok(nova, { requestId, status: 201 });
  } catch (err) {
    return responderErro(err, requestId, t, "reenviar");
  }
}
