/**
 * POST /api/v1/conversations/{id}/hide-comment — oculta o comentário na rede e
 * fecha o atendimento com o motivo `ocultado` (spec 22 §5.1).
 *
 * Oculto, o comentário só aparece para quem comentou e para a conta. É o botão
 * do spam e da ofensa: responder em público daria palco; deixar aberto deixaria
 * o atendimento na fila para sempre.
 *
 * Alvo: `message_id` (um comentário do cliente neste fio) ou, sem ele, o
 * comentário principal do fio.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { lerContextoDoComentario } from "@/lib/channels/comentarios/contexto";
import { fecharAtendimentoDeComentario } from "@/lib/channels/comentarios/fechar";
import { CONVERSA_COMENTARIO, tipoDeConversa } from "@/lib/channels/comentarios/vocabulario";
import { resolveZernioCreds } from "@/lib/channels/zernio/credentials";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const corpoSchema = z.object({ message_id: z.string().uuid().optional() });

export async function POST(req: NextRequest, { params }: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { feature: "inbox", requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("validation_failed", t("Conversa não encontrada."), 422, { requestId });
  const lido = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", t("Comentário inválido."), 422, { requestId });

  // Visibilidade pela RLS de quem pediu: só oculta o que ele pode ver.
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, organization_id, kind, metadata, provider_conversation_id, channel_sessions:channel_session_id(zernio_account_id)")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!conv) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  if (tipoDeConversa(conv.kind) !== CONVERSA_COMENTARIO) {
    return fail("validation_failed", t("Só comentários podem ser ocultados."), 422, { requestId });
  }

  const admin = createAdminClient();
  let commentId = conv.provider_conversation_id as string | null;
  if (lido.data.message_id) {
    const { data: msg } = await admin
      .from("messages")
      .select("external_id, direction")
      .eq("organization_id", authz.org.orgId)
      .eq("conversation_id", id)
      .eq("id", lido.data.message_id)
      .maybeSingle();
    if (!msg || msg.direction !== "inbound") {
      return fail("validation_failed", t("Escolha um comentário do cliente para ocultar."), 422, { requestId });
    }
    commentId = msg.external_id as string | null;
  }
  const platformPostId = lerContextoDoComentario(conv.metadata).platformPostId;
  const sessao = conv.channel_sessions as unknown as { zernio_account_id: string | null } | null;
  if (!commentId || !platformPostId || !sessao?.zernio_account_id) {
    return fail("validation_failed", t("Comentário sem identificação na rede social."), 422, { requestId });
  }

  const creds = await resolveZernioCreds(admin, { organizationId: authz.org.orgId, accountId: sessao.zernio_account_id });
  if (!creds) return fail("invalid_request", t("A conexão com a rede social não está configurada."), 422, { requestId });

  const res = await fetch(
    `${creds.baseUrl}/v1/inbox/comments/${encodeURIComponent(platformPostId)}/${encodeURIComponent(commentId)}/hide`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: creds.accountId }),
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => null);
  if (!res || !res.ok) {
    const corpo = (await res?.json().catch(() => null)) as { error?: string } | null;
    return fail(
      "invalid_request",
      `${t("A rede social não ocultou o comentário.")}${corpo?.error ? ` (${corpo.error})` : ""}`,
      502,
      { requestId },
    );
  }

  await fecharAtendimentoDeComentario(admin, {
    organizationId: authz.org.orgId,
    conversationId: id,
    motivo: "ocultado",
    actorUserId: authz.user.id,
    requestId,
  });

  return ok({ hidden: true, conversation_id: id }, { requestId });
}
