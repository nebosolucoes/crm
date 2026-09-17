/**
 * `requirePlatformAdmin()` para ROTAS DE API — devolve a recusa em vez de
 * `redirect()`.
 *
 * O helper original nasceu para o layout de `/admin`, onde redirecionar é o
 * gesto certo. Nas rotas ele é usado dentro de `try { … } catch { 403 }`, e o
 * `catch` engole QUALQUER erro — um banco fora do ar vira "Platform admin
 * required" na resposta, e quem investiga procura permissão onde há
 * infraestrutura. Este helper responde com a forma de `requireRole`
 * (`{ ok, response }`), deixa erro real subir como 500, e conserva as três
 * regras do original: JWT via `getUser()`, linha viva em `platform_admins`,
 * `aal2` quando `mfa_required`.
 *
 * `scope: "full"` é exigido nas escritas (`escrita: true`): quem só acompanha
 * (`support_readonly`) lê o catálogo e não o muda — a mesma régua das funções
 * SQL de plano, que exigem `full` no `p_actor`.
 */
import type { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { fail, type ApiError } from "@/lib/api/wrappers";
import { createClient } from "@/lib/supabase/server";

export type PlatformAdminApi =
  | { ok: true; user: User; scope: string; mfaRequired: boolean }
  | { ok: false; response: NextResponse<ApiError> };

export async function requirePlatformAdminApi(opts: {
  requestId?: string;
  escrita?: boolean;
} = {}): Promise<PlatformAdminApi> {
  const { requestId, escrita = false } = opts;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: fail("unauthenticated", "Auth required.", 401, { requestId }) };
  }

  const { data: paRow, error } = await supabase
    .from("platform_admins")
    .select("user_id, scope, mfa_required, revoked_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    return { ok: false, response: fail("internal_error", error.message, 500, { requestId }) };
  }
  if (!paRow) {
    return { ok: false, response: fail("forbidden", "Platform admin required", 403, { requestId }) };
  }
  if (escrita && paRow.scope !== "full") {
    return { ok: false, response: fail("forbidden", "Platform admin with full scope required", 403, { requestId }) };
  }
  if (paRow.mfa_required) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      return { ok: false, response: fail("mfa_required", "MFA (aal2) required", 403, { requestId }) };
    }
  }
  return { ok: true, user, scope: paRow.scope, mfaRequired: paRow.mfa_required };
}
