/**
 * GET   /api/v1/admin/plans/[id] — um plano, com recursos e contagem de organizações.
 * PATCH /api/v1/admin/plans/[id] — edita nome, descrição, recursos, limites, ativo, padrão.
 *
 * Não há DELETE de propósito: plano sai de circulação por `is_active = false`
 * (quem está nele continua), e a FK `restrict` recusaria apagar um com
 * organização. Um `plan.deactivated` no audit é a memória de que ele existiu.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { editarPlano, lerPlano } from "@/lib/entitlements/admin/planos";
import { planoEditarSchema } from "@/lib/entitlements/admin/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requirePlatformAdminApi({ requestId });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const plano = await lerPlano(createAdminClient(), id);
  if (!plano) return fail("not_found", "Plano não encontrado.", 404, { requestId });
  return ok(plano, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requirePlatformAdminApi({ requestId, escrita: true });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const parsed = planoEditarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId, details: parsed.error.flatten() });
  }

  const r = await editarPlano(createAdminClient(), authz.user.id, id, parsed.data);
  if (!r.ok) {
    if (r.codigo === "nao_encontrado") return fail("not_found", "Plano não encontrado.", 404, { requestId });
    if (r.codigo === "padrao_inativo") return fail("validation_failed", "O plano padrão precisa estar ativo.", 422, { requestId });
    if (r.codigo === "sem_padrao") {
      return fail("validation_failed", "Para tirar este plano do padrão, marque outro como padrão.", 422, { requestId });
    }
    return fail("internal_error", r.codigo, 500, { requestId });
  }

  const { antes, depois } = r.plano;
  const base = {
    actorUserId: authz.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "platform_plans",
    resourceId: id,
    requestId,
  } as const;
  void audit({ ...base, action: "plan.updated", metadata: { slug: depois.slug, patch: parsed.data, antes: { features: antes.features, limits: antes.limits, is_default: antes.is_default } } });
  if (antes.is_active !== depois.is_active) {
    void audit({ ...base, action: depois.is_active ? "plan.activated" : "plan.deactivated", metadata: { slug: depois.slug, organizations_count: depois.organizations_count } });
  }
  return ok(depois, { requestId });
}
