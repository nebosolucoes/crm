/**
 * GET   /api/v1/publicacoes/ocorrencias/[id] — a ocorrência com a publicação e
 *                                              TODAS as execuções (o Sheet e o Histórico).
 * PATCH /api/v1/publicacoes/ocorrencias/[id] — alterar só o horário desta ocorrência
 *                                              (vira `manual`; as outras não mudam).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { reagendarOcorrenciaSchema } from "@/lib/publicacoes/schema";
import { detalheDaOcorrencia, reagendarOcorrencia } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerCorpo, responderErro, responderValidacao } from "../../_comum";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "publication_occurrences" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  try {
    const detalhe = await detalheDaOcorrencia(createAdminClient(), authz.org.orgId, id);
    if (!detalhe) return fail("not_found", t("Ocorrência não encontrada."), 404, { requestId });
    return ok(detalhe, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "detalhe da ocorrência");
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_occurrences" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;

  const parsed = reagendarOcorrenciaSchema.safeParse(await lerCorpo(req));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);

  try {
    const ocorrencia = await reagendarOcorrencia(createAdminClient(), { orgId: authz.org.orgId, userId: authz.user.id }, id, parsed.data.scheduled_at);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.occurrence_rescheduled",
      resourceType: "publication_occurrences",
      resourceId: id,
      requestId,
      metadata: { scheduled_at: ocorrencia.scheduled_at },
    });
    return ok(ocorrencia, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "reagendar");
  }
}
