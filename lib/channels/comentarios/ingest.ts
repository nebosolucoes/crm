/**
 * Ingestão do `comment.received`: webhook → contato, fio do comentário,
 * mensagem (spec 22 §3). A leitura do payload é pura e mora em
 * `lib/channels/zernio/comentarios.ts`; aqui ficam os efeitos.
 *
 * ─── Um atendimento por comentário principal ────────────────────────────────
 *
 * A raiz do fio é o comentário principal. Resposta (de quem quer que seja) entra
 * no fio da raiz; resposta a um comentário que nunca entrou (anterior à
 * conexão, ou perdido) abre o fio pelo PAI mesmo — o atendente vê o que chegou
 * em vez de nada.
 *
 * ─── Comentário da própria conta ────────────────────────────────────────────
 *
 * A Meta reentrega as respostas da conta conectada como comentário
 * (`author.isOwnAccount = true`). Dois casos:
 *   - é o eco do que o CRM acabou de responder → dedupe, nada muda;
 *   - não é → alguém respondeu PELO APP. Entra no fio como saída e FECHA o
 *     atendimento (`respondido_pelo_app`) — decisão do dono.
 * Comentário da conta que não responde a fio nenhum (a marca comentando no
 * próprio post) não abre atendimento.
 *
 * ─── O que um comentário NÃO faz (primeira entrega) ─────────────────────────
 *
 * Não acorda a IA, não abre lead e não passa pelo opt-out: comentário é
 * público, e "parar" num comentário não é pedido de descadastro. Entra na fila
 * pelo `routing-worker`, que pega conversa aberta sem dono — o mesmo caminho do
 * Direct. Idempotência: `unique (organization_id, external_id)` com 23505.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { marcarConversaComMensagem } from "@/lib/channels/marcar-conversa";

import { contextoDoPost, parseZernioComentario, type ComentarioRecebido } from "../zernio/comentarios";

import { fecharAtendimentoDeComentario } from "./fechar";
import { CONVERSA_COMENTARIO } from "./vocabulario";

export interface ResultadoDoComentario {
  status: "ingested" | "duplicate" | "ignored" | "closed";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

export interface SessaoDoComentario {
  plataforma: string;
  accountId: string | null;
  /** `channel_sessions.inbox_comments` — a escolha do admin (spec 22 §4). */
  recebeComentarios: boolean;
}

const TERMINAIS = new Set(["closed", "resolved", "archived"]);

export async function ingerirComentario(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelSessionId: string;
    payload: unknown;
    sessao: SessaoDoComentario;
  },
): Promise<ResultadoDoComentario> {
  const c = parseZernioComentario(input.payload);
  if (!c) return { status: "ignored", reason: "comentario_ilegivel" };

  if (c.plataforma !== input.sessao.plataforma) return { status: "ignored", reason: "rede_de_outra_sessao" };
  if (input.sessao.accountId && c.contas.length > 0 && !c.contas.includes(input.sessao.accountId)) {
    return { status: "ignored", reason: "conta_de_outra_sessao" };
  }
  // Defesa além do filtro de eventos no provedor: desligar demora até 5 min
  // para valer lá (doc da Zernio), e um webhook antigo pode seguir assinando.
  if (!input.sessao.recebeComentarios) return { status: "ignored", reason: "comentarios_desligados" };

  const base = { organizationId: input.organizationId, channelSessionId: input.channelSessionId };

  if (c.autor.ehDaConta === true) return respostaDaConta(admin, base, c);
  return comentarioDeTerceiro(admin, base, c);
}

type Base = { organizationId: string; channelSessionId: string };

async function comentarioDeTerceiro(admin: SupabaseClient, base: Base, c: ComentarioRecebido): Promise<ResultadoDoComentario> {
  const raiz = await raizDoFio(admin, base, c);

  const { data: contato, error: erroContato } = await admin.rpc("fn_upsert_social_contact", {
    p_org: base.organizationId,
    p_platform: c.plataforma,
    p_user_id: c.autor.id,
    p_session: base.channelSessionId,
    p_username: c.autor.username ?? "",
    p_name: c.autor.nome ?? "",
  });
  if (erroContato || !contato) {
    logger.warn("[comentarios] contato não resolvido", { detail: erroContato?.message ?? "sem id" });
    return { status: "ignored", reason: "contato_nao_resolvido" };
  }
  const contactId = contato as string;

  // Dono do fio é quem fez o comentário principal. Numa resposta de TERCEIRO a
  // um fio que já existe, o fio continua do dono original — a resposta entra
  // nele, assinada por quem escreveu.
  const fioExistente = raiz.conversa;
  let conversationId: string;
  if (fioExistente) {
    conversationId = fioExistente.id;
  } else {
    const { data, error } = await admin.rpc("fn_upsert_comment_conversation", {
      p_org: base.organizationId,
      p_contact: contactId,
      p_session: base.channelSessionId,
      p_root_comment_id: raiz.id,
      p_contexto: contextoDoPost(c) as never,
    });
    if (error || !data) {
      logger.warn("[comentarios] fio não resolvido", { detail: error?.message ?? "sem id" });
      return { status: "ignored", reason: "fio_nao_resolvido" };
    }
    conversationId = data as string;
  }

  const inserida = await inserirComentario(admin, base, {
    conversationId,
    contactId: fioExistente?.contact_id ?? contactId,
    c,
    direcao: "inbound",
    origem: null,
  });
  if (inserida === "duplicate") return { status: "duplicate", conversationId };

  await reabrirSeFechado(admin, base.organizationId, conversationId, c.criadoEm);
  await marcarConversaComMensagem(admin, {
    organizationId: base.organizationId,
    conversationId,
    direction: "inbound",
    preview: previa(c),
    at: c.criadoEm ?? new Date().toISOString(),
    canal: "zernio",
  });

  return { status: "ingested", conversationId, messageId: inserida };
}

async function respostaDaConta(admin: SupabaseClient, base: Base, c: ComentarioRecebido): Promise<ResultadoDoComentario> {
  // Eco pelo id: o CRM grava o id que o provedor devolveu ao responder.
  const { data: mesmoId } = await admin
    .from("messages")
    .select("id, conversation_id")
    .eq("organization_id", base.organizationId)
    .eq("external_id", c.commentId)
    .maybeSingle();
  if (mesmoId) return { status: "duplicate", conversationId: mesmoId.conversation_id as string };

  if (!c.parentCommentId) return { status: "ignored", reason: "comentario_da_conta_sem_fio" };
  const raiz = await raizDoFio(admin, base, c);
  if (!raiz.conversa) return { status: "ignored", reason: "resposta_da_conta_sem_fio" };
  const conversationId = raiz.conversa.id;

  // Eco sem o mesmo id (não medido em conta real — spec 22 §11): mesmo fio,
  // mesmo texto, saído do CRM nos últimos 10 minutos.
  if (await ecoDoNossoEnvio(admin, base.organizationId, conversationId, c.texto)) {
    return { status: "duplicate", conversationId, reason: "eco_do_proprio_envio" };
  }

  const inserida = await inserirComentario(admin, base, {
    conversationId,
    contactId: raiz.conversa.contact_id,
    c,
    direcao: "outbound",
    origem: "app",
  });
  if (inserida === "duplicate") return { status: "duplicate", conversationId };

  await marcarConversaComMensagem(admin, {
    organizationId: base.organizationId,
    conversationId,
    direction: "outbound",
    preview: previa(c),
    at: c.criadoEm ?? new Date().toISOString(),
    canal: "zernio",
  });

  const r = await fecharAtendimentoDeComentario(admin, {
    organizationId: base.organizationId,
    conversationId,
    motivo: "respondido_pelo_app",
    actorUserId: null,
  });
  return { status: r.fechou ? "closed" : "ingested", conversationId, messageId: inserida, reason: "respondido_pelo_app" };
}

/**
 * Em que fio este comentário entra. A raiz é o comentário principal; a
 * resposta procura o fio pelo PAI — como fio (o pai é a raiz) ou como
 * mensagem de um fio (o pai é outra resposta, Facebook aninha).
 */
async function raizDoFio(
  admin: SupabaseClient,
  base: Base,
  c: ComentarioRecebido,
): Promise<{ id: string; conversa: { id: string; contact_id: string } | null }> {
  if (!c.ehResposta || !c.parentCommentId) {
    return { id: c.commentId, conversa: await fioPelaRaiz(admin, base, c.commentId) };
  }
  const pai = c.parentCommentId;
  const comoRaiz = await fioPelaRaiz(admin, base, pai);
  if (comoRaiz) return { id: pai, conversa: comoRaiz };

  const { data: msg } = await admin
    .from("messages")
    .select("conversation_id")
    .eq("organization_id", base.organizationId)
    .eq("external_id", pai)
    .maybeSingle();
  if (msg?.conversation_id) {
    const { data: conv } = await admin
      .from("conversations")
      .select("id, contact_id, provider_conversation_id")
      .eq("organization_id", base.organizationId)
      .eq("id", msg.conversation_id as string)
      .eq("kind", CONVERSA_COMENTARIO)
      .maybeSingle();
    if (conv) {
      return {
        id: (conv.provider_conversation_id as string | null) ?? pai,
        conversa: { id: conv.id as string, contact_id: conv.contact_id as string },
      };
    }
  }
  return { id: pai, conversa: null };
}

async function fioPelaRaiz(
  admin: SupabaseClient,
  base: Base,
  raiz: string,
): Promise<{ id: string; contact_id: string } | null> {
  const { data } = await admin
    .from("conversations")
    .select("id, contact_id")
    .eq("organization_id", base.organizationId)
    .eq("channel_session_id", base.channelSessionId)
    .eq("kind", CONVERSA_COMENTARIO)
    .eq("provider_conversation_id", raiz)
    .maybeSingle();
  return data ? { id: data.id as string, contact_id: data.contact_id as string } : null;
}

async function inserirComentario(
  admin: SupabaseClient,
  base: Base,
  input: {
    conversationId: string;
    contactId: string;
    c: ComentarioRecebido;
    direcao: "inbound" | "outbound";
    origem: "app" | null;
  },
): Promise<string | "duplicate"> {
  const { c } = input;
  // Facebook: sticker/GIF/foto sem texto. A URL é efêmera (oe=); vai para o
  // mesmo worker de persistência que guarda as mídias do Direct.
  const imagem = c.anexo?.imagemUrl ?? null;
  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: base.organizationId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      channel_session_id: base.channelSessionId,
      external_id: c.commentId,
      direction: input.direcao,
      // Veio de fora do CRM: o comentário do cliente e a resposta pelo app.
      sent_via: "external_device",
      status: input.direcao === "outbound" ? "sent" : "delivered",
      type: imagem ? "image" : "text",
      body: c.texto || null,
      ...(imagem ? { media_url: imagem, media_mime: "image/jpeg" } : {}),
      metadata: {
        comentario: {
          parent_comment_id: c.parentCommentId,
          platform_post_id: c.platformPostId,
          autor: { id: c.autor.id, username: c.autor.username, nome: c.autor.nome },
          ...(input.origem ? { origem: input.origem } : {}),
        },
      },
      ...(c.criadoEm ? { sent_at: c.criadoEm } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return "duplicate";
  if (error || !data) throw new Error(`comentario_insert_failed: ${error?.message ?? "sem id"}`);

  const id = (data as { id: string }).id;
  if (imagem) {
    const { error: erroMidia } = await admin.rpc("emit_event" as never, {
      p_event_type: "media.persist_requested",
      p_entity_kind: "message",
      p_entity_id: id,
      p_payload: { message_id: id, conversation_id: input.conversationId },
      p_metadata: { source: "zernio_comment" },
      p_organization_id: base.organizationId,
    } as never);
    if (erroMidia) logger.warn("[comentarios] persistência da mídia não pedida", { detail: erroMidia.message });
  }
  return id;
}

/** Comentário novo num fio fechado reabre o atendimento — e o banco o devolve à fila. */
async function reabrirSeFechado(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  criadoEm: string | null,
): Promise<void> {
  const { data } = await admin
    .from("conversations")
    .select("status, service_closed_at, service_revision")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!data || !TERMINAIS.has(data.status as string)) return;
  // Reentrega atrasada de um comentário ANTERIOR ao fechamento não reabre.
  const fechouEm = data.service_closed_at ? Date.parse(data.service_closed_at as string) : null;
  if (fechouEm && criadoEm && Date.parse(criadoEm) <= fechouEm) return;
  const { error } = await admin.rpc("fn_service_status", {
    p_org: organizationId,
    p_conversation: conversationId,
    p_status: "open",
    p_expected: data.service_revision as number,
  });
  if (error) logger.warn("[comentarios] fio não reaberto", { conversationId, detail: error.message });
}

async function ecoDoNossoEnvio(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  texto: string,
): Promise<boolean> {
  if (!texto) return false;
  const desde = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("body", texto)
    .neq("sent_via", "external_device")
    .gte("created_at", desde)
    .limit(1);
  return (data ?? []).length > 0;
}

function previa(c: ComentarioRecebido): string {
  return (c.texto || (c.anexo ? "[imagem]" : "")).slice(0, 200);
}

