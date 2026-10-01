/**
 * PATCH /api/v1/channel-sessions/{id}/inbox — o que uma conexão de Instagram
 * ou Facebook entrega para a inbox: mensagens diretas, comentários, ou os dois.
 *
 * Grava `inbox_direct`/`inbox_comments` e troca os eventos do webhook no
 * provedor (`mudarEntregaDaConexao`, que explica a ordem). Spec 22 §4.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { mudarEntregaDaConexao } from "@/lib/channels/social";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const corpoSchema = z
  .object({ inbox_direct: z.boolean(), inbox_comments: z.boolean() })
  .refine((c) => c.inbox_direct || c.inbox_comments, { message: "nada_a_entregar" });

export async function PATCH(req: NextRequest, { params }: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_sessions", allowPlatformAdmin: true });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("validation_failed", t("Canal inválido."), 422, { requestId });

  const lido = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", t("Escolha pelo menos uma: mensagens diretas ou comentários."), 422, { requestId });
  }

  const entrega = { direct: lido.data.inbox_direct, comentarios: lido.data.inbox_comments };
  const r = await mudarEntregaDaConexao(createAdminClient(), {
    organizationId: auth.org.orgId,
    sessionId: id,
    entrega,
  });
  if (!r.ok) {
    const naoAchou = r.motivo === "Conexão não encontrada.";
    return fail(naoAchou ? "not_found" : "invalid_request", t(r.motivo), naoAchou ? 404 : 422, { requestId });
  }

  void audit({
    action: "channel.inbox_scope_changed",
    actorUserId: auth.user.id,
    organizationId: auth.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: {
      antes: { inbox_direct: r.valor.antes.direct, inbox_comments: r.valor.antes.comentarios },
      depois: lido.data,
      provedor_atualizado: r.valor.provedorAtualizado,
    },
  });

  return ok({ ...lido.data, provedor_atualizado: r.valor.provedorAtualizado }, { requestId });
}
