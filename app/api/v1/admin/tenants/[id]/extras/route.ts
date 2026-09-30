/**
 * GET  /api/v1/admin/tenants/[id]/extras — as conexões extras da organização
 *      (ativas e encerradas).
 * POST /api/v1/admin/tenants/[id]/extras — vende "+N" de uma chave de conexão
 *      (`max_whatsapp`, `max_instagram`, `max_messenger`, `max_channels`). SOMA
 *      ao teto do plano. Spec 21 §10 / migration 0281.
 *
 * Admin da instalação só. A organização vem do PATH.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { criarExtra, extraCriarSchema, listarExtras } from "@/lib/entitlements/admin/extras";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requirePlatformAdminApi({ requestId });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  return ok(await listarExtras(createAdminClient(), id), { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;
  const authz = await requirePlatformAdminApi({ requestId, escrita: true });
  if (!authz.ok) return authz.response;

  const parsed = extraCriarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Informe a conexão, a quantidade (1 a 1000) e o motivo.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const r = await criarExtra(createAdminClient(), { actorId: authz.user.id, orgId: id, extra: parsed.data, requestId });
  if (!r.ok) return fail("internal_error", r.motivo, 500, { requestId });
  return ok({ id: r.id }, { requestId, status: 201 });
}
