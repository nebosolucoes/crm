/**
 * GET    /api/v1/publicacoes/[id] — a publicação montada (mídia, destinos, ocorrências).
 * PATCH  /api/v1/publicacoes/[id] — editar conteúdo, destinos, datas, recorrência.
 *                                   Regera as ocorrências PENDENTES; o passado fica.
 * DELETE /api/v1/publicacoes/[id] — excluir (soft): cancela o pendente, some das telas,
 *                                   preserva a história e a auditoria.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, noContent, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { alterarPublicacaoSchema } from "@/lib/publicacoes/schema";
import { alterarPublicacao, carregarPublicacao, excluirPublicacao } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerCorpo, responderErro, responderValidacao } from "../_comum";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "publications" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  try {
    const publicacao = await carregarPublicacao(createAdminClient(), authz.org.orgId, id);
    if (!publicacao) return fail("not_found", t("Publicação não encontrada."), 404, { requestId });
    return ok(publicacao, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "ler");
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publications" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;

  const parsed = alterarPublicacaoSchema.safeParse(await lerCorpo(req));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);

  try {
    const publicacao = await alterarPublicacao(createAdminClient(), { orgId: authz.org.orgId, userId: authz.user.id }, id, parsed.data);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.updated",
      resourceType: "publications",
      resourceId: id,
      requestId,
      metadata: {
        campos: Object.keys(parsed.data),
        status: publicacao.status,
        occurrences_pending: publicacao.occurrences.filter((o) => o.status === "pending").length,
      },
    });
    return ok(publicacao, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "editar");
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publications" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  try {
    await excluirPublicacao(createAdminClient(), { orgId: authz.org.orgId, userId: authz.user.id }, id);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.deleted",
      resourceType: "publications",
      resourceId: id,
      requestId,
    });
    return noContent(requestId);
  } catch (err) {
    return responderErro(err, requestId, t, "excluir");
  }
}
