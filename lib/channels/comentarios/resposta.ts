/**
 * O que o envio de mensagens (`app/api/v1/messages/_handler.ts`) precisa saber
 * para responder um COMENTÁRIO (spec 22 §5.1) — antes e depois do provedor.
 *
 * Antes: validar o pedido e escolher o comentário-alvo. Depois: gastar a
 * resposta privada e fechar o atendimento quando a política manda.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import type { SendMessageInput } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerContextoDoComentario, respostaPrivadaDisponivel } from "./contexto";
import { fecharAtendimentoDeComentario } from "./fechar";
import { politicaDaOrganizacao } from "./politica";
import { tipoDeConversa, CONVERSA_COMENTARIO } from "./vocabulario";

export interface RespostaDeComentario {
  platformPostId: string;
  /** O comentário que recebe a resposta (id da plataforma). */
  commentId: string;
  /** Nossa linha do comentário-alvo, quando ele está no histórico. */
  alvoMessageId: string | null;
  modo: "publico" | "privado";
}

/**
 * `null` quando a conversa não é de comentário — o envio segue como sempre.
 * Lança `ApiError` 4xx quando o pedido não cabe num comentário.
 */
export async function prepararRespostaDeComentario(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  c: { id: string; kind?: string | null; metadata?: unknown; provider_conversation_id: string | null },
  input: SendMessageInput,
  citada: { id: string; external_id: string | null } | null,
): Promise<RespostaDeComentario | null> {
  if (tipoDeConversa(c.kind) !== CONVERSA_COMENTARIO) return null;
  const t = (texto: string) => traduzir(texto, ctx.idioma ?? "pt-BR");
  const recusa = (status: number, codigo: "forbidden" | "validation_error", texto: string) =>
    new ApiError(status, codigo, undefined, ctx.requestId, t(texto));

  // Primeira entrega: comentário é público e a IA não responde (decisão do dono).
  if (ctx.actor.type !== "user" && ctx.actor.type !== "api_token") {
    throw recusa(403, "forbidden", "A IA não responde comentários. Um atendente responde pela inbox.");
  }
  if (input.type !== "text" || input.media_storage_path || input.media_url) {
    throw recusa(422, "validation_error", "Resposta a comentário aceita só texto.");
  }

  const contexto = lerContextoDoComentario(c.metadata);
  if (!contexto.platformPostId) {
    throw recusa(422, "validation_error", "Não sei em qual publicação este comentário está. Abra a publicação e responda por lá.");
  }

  // Alvo: o comentário citado; senão o último do cliente no fio; senão a raiz.
  const consulta = supabase
    .from("messages")
    .select("id, external_id, direction, sent_at, created_at, metadata")
    .eq("organization_id", ctx.organization_id)
    .eq("conversation_id", c.id);
  const { data: alvo } = citada
    ? await consulta.eq("id", citada.id).maybeSingle()
    : await consulta.eq("direction", "inbound").order("sent_at", { ascending: false }).limit(1).maybeSingle();

  if (citada && (!alvo || alvo.direction !== "inbound")) {
    throw recusa(422, "validation_error", "Escolha um comentário do cliente para responder.");
  }
  const commentId = (alvo?.external_id as string | null | undefined) ?? c.provider_conversation_id;
  if (!commentId) throw recusa(422, "validation_error", "Comentário sem identificação na rede social.");

  const modo = input.comment_reply_mode === "private" ? "privado" : "publico";
  if (modo === "privado") {
    const disponivel =
      alvo !== null &&
      respostaPrivadaDisponivel({
        criadoEm: (alvo?.sent_at as string | null) ?? (alvo?.created_at as string | null) ?? null,
        metadata: alvo?.metadata,
      });
    if (!disponivel) {
      throw recusa(422, "validation_error", "A resposta no Direct deste comentário já foi usada ou passou de 7 dias.");
    }
  }

  return {
    platformPostId: contexto.platformPostId,
    commentId,
    alvoMessageId: (alvo?.id as string | undefined) ?? null,
    modo,
  };
}

/**
 * Depois do provedor. `enviou = false` só chega aqui quando a Meta já gastou a
 * resposta privada mesmo recusando (`privateReplyConsumed`): marca "usada" para
 * a tela não oferecer de novo, e não fecha nada.
 */
export async function depoisDaRespostaDeComentario(
  ctx: HandlerCtx,
  conversationId: string,
  resposta: RespostaDeComentario,
  enviou: boolean,
): Promise<void> {
  const admin = createAdminClient();
  try {
    if (resposta.modo === "privado" && resposta.alvoMessageId) {
      const { data: alvo } = await admin
        .from("messages")
        .select("metadata")
        .eq("organization_id", ctx.organization_id)
        .eq("id", resposta.alvoMessageId)
        .maybeSingle();
      const meta = (alvo?.metadata ?? {}) as Record<string, unknown>;
      const comentario = (meta.comentario ?? {}) as Record<string, unknown>;
      await admin
        .from("messages")
        .update({ metadata: { ...meta, comentario: { ...comentario, private_reply: "usada" } } })
        .eq("organization_id", ctx.organization_id)
        .eq("id", resposta.alvoMessageId);
    }

    if (!enviou || ctx.actor.type !== "user") return;
    const politica = await politicaDaOrganizacao(admin, ctx.organization_id);
    if (!politica.fechar_ao_responder) return;
    await fecharAtendimentoDeComentario(admin, {
      organizationId: ctx.organization_id,
      conversationId,
      motivo: "respondido_no_crm",
      actorUserId: ctx.actor.id,
      requestId: ctx.requestId,
    });
  } catch (err) {
    // A resposta SAIU. Falhar aqui não pode virar "falhou o envio" na tela.
    logger.warn("[comentarios] pós-resposta incompleto", {
      conversationId,
      detail: err instanceof Error ? err.message.slice(0, 160) : "unknown",
    });
  }
}
