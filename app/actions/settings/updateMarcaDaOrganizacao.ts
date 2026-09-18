"use server";

import { supportWriteError } from "@/lib/impersonate/support";

import { loadAuthUser } from "@/lib/auth/server";
import {
  marcaDaOrganizacaoSchema,
  type MarcaDaOrganizacaoInput,
} from "@/lib/schemas/settings";

export type UpdateMarcaDaOrganizacaoResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "validation_failed"
        | "unauthenticated"
        | "forbidden_tenant"
        | "forbidden_role"
        | "mfa_required"
        | "nao_gravou"
        | "db_error";
      details?: unknown;
    };

/**
 * Action legada de marca por organização.
 *
 * A marca visual agora é uma configuração exclusiva da plataforma, editada em
 * `/admin/marca`. Esta proteção server-side fica de pé para POSTs diretos ou
 * clientes antigos, mas não escreve em `organizations.settings`.
 */
export async function updateMarcaDaOrganizacao(
  input: MarcaDaOrganizacaoInput,
): Promise<UpdateMarcaDaOrganizacaoResult> {
  const parsed = marcaDaOrganizacaoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support)) return { ok: false, error: "forbidden_role" };

  return { ok: false, error: "forbidden_role" };
}
