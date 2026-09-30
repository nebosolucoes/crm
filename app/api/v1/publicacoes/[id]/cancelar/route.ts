/**
 * POST /api/v1/publicacoes/[id]/cancelar — cancela a publicação inteira: toda
 * ocorrência pendente vira `cancelled` e nada mais sai. O que já saiu fica no
 * Histórico. Exige um motivo (vai para a auditoria e para a tela).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { cancelarPublicacaoSchema } from "@/lib/publicacoes/schema";
import { cancelarPublicacao } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerCorpo, responderErro, responderValidacao } from "../../_comum";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publications" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;

  const parsed = cancelarPublicacaoSchema.safeParse(await lerCorpo(req));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);

  try {
    const publicacao = await cancelarPublicacao(createAdminClient(), { orgId: authz.org.orgId, userId: authz.user.id }, id, parsed.data.reason);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.cancelled",
      resourceType: "publications",
      resourceId: id,
      requestId,
      metadata: { reason: parsed.data.reason },
    });
    return ok(publicacao, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "cancelar");
  }
}
