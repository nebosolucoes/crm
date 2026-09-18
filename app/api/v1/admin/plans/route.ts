/**
 * GET  /api/v1/admin/plans — o catálogo de planos da instalação.
 * POST /api/v1/admin/plans — cria um plano.
 *
 * Platform admin; escrita exige escopo `full`. Sem `Idempotency-Key`: o
 * `slug` é único, então repetir o POST devolve 409 `state_conflict` — a
 * idempotência natural de quem tem chave de negócio.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { criarPlano, listarPlanos } from "@/lib/entitlements/admin/planos";
import { planoCriarSchema } from "@/lib/entitlements/admin/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requirePlatformAdminApi({ requestId });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const planos = await listarPlanos(admin);
  void audit({
    action: "platform_admin.plans_listed",
    actorUserId: authz.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: { count: planos.length },
  });
  return ok(planos, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  // Quem só acompanha uma organização (suporte somente leitura) não muda o catálogo.
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requirePlatformAdminApi({ requestId, escrita: true });
  if (!authz.ok) return authz.response;

  const parsed = planoCriarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId, details: parsed.error.flatten() });
  }

  const admin = createAdminClient();
  const r = await criarPlano(admin, authz.user.id, parsed.data);
  if (!r.ok) {
    if (r.codigo === "slug_em_uso") return fail("state_conflict", "Já existe um plano com este slug.", 409, { requestId });
    if (r.codigo === "padrao_inativo") return fail("validation_failed", "O plano padrão precisa estar ativo.", 422, { requestId });
    return fail("internal_error", r.codigo, 500, { requestId });
  }
  void audit({
    action: "plan.created",
    actorUserId: authz.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "platform_plans",
    resourceId: r.plano.id,
    requestId,
    metadata: { slug: r.plano.slug, name: r.plano.name, features: r.plano.features, limits: r.plano.limits, is_default: r.plano.is_default },
  });
  return ok(r.plano, { requestId, status: 201 });
}
