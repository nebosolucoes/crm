/**
 * DELETE /api/v1/admin/tenants/[id]/overrides/[overrideId] — REVOGA (carimba
 * `revoked_at`), nunca apaga: a linha é a única memória de que a liberação
 * existiu. Corpo `{ reason }` obrigatório. Já revogado → 409.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { revogarOverride } from "@/lib/entitlements/admin/organizacoes";
import { revogarOverrideSchema } from "@/lib/entitlements/admin/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; overrideId: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id, overrideId } = await ctx.params;
  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;
  const authz = await requirePlatformAdminApi({ requestId, escrita: true });
  if (!authz.ok) return authz.response;

  const parsed = revogarOverrideSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Informe o motivo (3 a 500 caracteres).", 422, { requestId, details: parsed.error.flatten() });
  }

  const r = await revogarOverride(createAdminClient(), authz.user.id, id, overrideId, parsed.data.reason, requestId);
  if (!r.ok) {
    const status = r.codigo === "forbidden" ? 403 : r.codigo === "internal_error" ? 500 : 422;
    return fail(r.codigo, r.mensagem, status, { requestId });
  }
  if (!r.valor.revoked) return fail("state_conflict", "Este override já estava revogado ou não pertence a esta organização.", 409, { requestId });
  return ok({ id: overrideId, revoked: true }, { requestId });
}
