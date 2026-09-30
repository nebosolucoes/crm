/**
 * DELETE /api/v1/admin/tenants/[id]/extras/[extraId] — encerra uma conexão
 * extra (carimba `revoked_at`; a linha fica como histórico). Já encerrada → 409.
 *
 * Encerrar NÃO desconecta nada: se a organização estiver acima do teto novo,
 * as conexões seguem; só a próxima conexão é recusada. Spec 21 §10.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { revogarExtra } from "@/lib/entitlements/admin/extras";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; extraId: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id, extraId } = await ctx.params;
  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;
  const authz = await requirePlatformAdminApi({ requestId, escrita: true });
  if (!authz.ok) return authz.response;

  const revogado = await revogarExtra(createAdminClient(), { actorId: authz.user.id, orgId: id, extraId, requestId });
  if (!revogado) return fail("state_conflict", "Este extra já estava encerrado ou não pertence a esta organização.", 409, { requestId });
  return ok({ id: extraId, revoked: true }, { requestId });
}
