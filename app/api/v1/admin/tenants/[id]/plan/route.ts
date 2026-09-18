/**
 * GET /api/v1/admin/tenants/[id]/plan — o que a organização pode usar: plano
 *     atribuído, efetivo (função SQL), TODOS os overrides, e o catálogo ativo
 *     para o seletor.
 * PUT /api/v1/admin/tenants/[id]/plan — atribui um plano (com motivo).
 *
 * A escrita vai pela RPC `fn_definir_plano_da_organizacao`, que confere o
 * `p_actor` no banco e é o único caminho para `organizations.plan_id`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { atribuirPlano, visaoDeEntitlements } from "@/lib/entitlements/admin/organizacoes";
import { listarPlanos } from "@/lib/entitlements/admin/planos";
import { atribuirPlanoSchema } from "@/lib/entitlements/admin/schemas";
import { serializarEntitlements } from "@/lib/entitlements/tipos";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requirePlatformAdminApi({ requestId });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const [visao, planos] = await Promise.all([visaoDeEntitlements(admin, id), listarPlanos(admin)]);
  if (!visao) return fail("not_found", "Tenant not found", 404, { requestId });

  void audit({
    action: "platform_admin.tenant_entitlements_viewed",
    actorUserId: authz.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
  });
  return ok(
    {
      organization_id: visao.organization_id,
      plan_id: visao.plan_id,
      plan_assigned_at: visao.plan_assigned_at,
      efetivo: serializarEntitlements(visao.efetivo),
      overrides: visao.overrides,
      consumo: visao.consumo,
      planos,
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;
  const authz = await requirePlatformAdminApi({ requestId, escrita: true });
  if (!authz.ok) return authz.response;

  const parsed = atribuirPlanoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId, details: parsed.error.flatten() });
  }

  const r = await atribuirPlano(createAdminClient(), authz.user.id, id, parsed.data.plan_id, parsed.data.reason, requestId);
  if (!r.ok) {
    const status = r.codigo === "not_found" ? 404 : r.codigo === "forbidden" ? 403 : r.codigo === "internal_error" ? 500 : 422;
    return fail(r.codigo, r.mensagem, status, { requestId });
  }
  return ok(r.valor, { requestId });
}
