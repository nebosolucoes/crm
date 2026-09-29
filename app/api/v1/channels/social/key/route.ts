/**
 * POST /api/v1/channels/social/key — grava (ou troca) a chave de API do
 * provedor que conecta Instagram Direct e Messenger.
 *
 * VALIDA antes de gravar, contra o provedor, as duas coisas que falham
 * separado: a chave presta, e ela alcança a caixa de entrada. Trocar a chave
 * propaga a cifra nova para as conexões já feitas (ver `lib/channels/social`).
 * Spec 21 §3.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { salvarChaveSocial } from "@/lib/channels/social";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.object({ api_key: z.string().trim().min(8).max(500) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_social" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const lido = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("invalid_request", t("Cole a chave de API."), 422, { requestId });

  const r = await salvarChaveSocial(createAdminClient(), {
    organizationId: authz.org.orgId,
    apiKey: lido.data.api_key,
    userId: authz.user.id,
  });
  if (!r.ok) return fail("invalid_request", t(r.motivo), 422, { requestId });

  void audit({
    action: "channel.provider_key_saved",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_provider_keys",
    requestId,
    // Quantas conexões passaram a usar a chave nova — nunca a chave.
    metadata: { sessoes_atualizadas: r.valor.sessoesAtualizadas },
  });

  return ok({ saved: true, connections_updated: r.valor.sessoesAtualizadas }, { requestId });
}
