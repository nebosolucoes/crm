/**
 * GET /api/v1/channels/social — as conexões de Instagram Direct e Messenger da
 * organização, e se a chave do provedor já foi cadastrada.
 *
 * A chave **nunca volta**: a resposta diz que ela existe, não qual é.
 * Spec 21 §3. Admin only — conectar canal expõe a conta da empresa.
 */
import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { listarConexoesSociais, SOCIAL_PROVIDER_LABEL, temChaveSocial } from "@/lib/channels/social";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_social" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const [temChave, conexoes] = await Promise.all([
    temChaveSocial(admin, authz.org.orgId),
    listarConexoesSociais(admin, authz.org.orgId),
  ]);

  return ok(
    {
      label: SOCIAL_PROVIDER_LABEL,
      has_api_key: temChave,
      connections: conexoes.map((c) => ({
        id: c.id,
        platform: c.plataforma,
        platform_label: c.rotulo,
        display_name: c.nome,
        username: c.usuario,
        avatar_url: c.avatarUrl,
        status: c.status,
        created_at: c.criadaEm,
      })),
    },
    { requestId },
  );
}
