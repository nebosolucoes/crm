/**
 * O ÚNICO leitor de `conversations.metadata.comentario` e de
 * `messages.metadata.comentario` (spec 22 §2.2). A tela e as rotas leem por
 * aqui — nunca o path do jsonb direto (anti-pattern 6 do CLAUDE.md).
 *
 * Quem grava: `fn_upsert_comment_conversation` (contexto do post),
 * `lib/channels/comentarios/ingest.ts` (cada comentário) e
 * `lib/channels/comentarios/fechar.ts` (motivo do fechamento).
 */
import { z } from "zod";

import { MOTIVOS_DE_FECHAMENTO_DE_COMENTARIO, type MotivoDeFechamentoDeComentario } from "./vocabulario";

const textoOuNulo = z.string().nullish().transform((v) => v ?? null);

const contextoSchema = z
  .object({
    platform_post_id: textoOuNulo,
    post_id: textoOuNulo,
    permalink: textoOuNulo,
    post_text: textoOuNulo,
    post_image_url: textoOuNulo,
    is_ad: z.boolean().nullish().transform((v) => v === true),
    ad_title: textoOuNulo,
    fechamento: z
      .object({ motivo: z.enum(MOTIVOS_DE_FECHAMENTO_DE_COMENTARIO), em: z.string() })
      .nullish()
      .transform((v) => v ?? null),
  })
  .partial();

export interface ContextoDoComentario {
  platformPostId: string | null;
  postId: string | null;
  permalink: string | null;
  textoDoPost: string | null;
  imagemDoPost: string | null;
  ehAnuncio: boolean;
  tituloDoAnuncio: string | null;
  fechamento: { motivo: MotivoDeFechamentoDeComentario; em: string } | null;
}

/** Lê o contexto do post; metadata torta vira contexto vazio, nunca exceção. */
export function lerContextoDoComentario(metadata: unknown): ContextoDoComentario {
  const bruto = (metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).comentario : null) ?? {};
  const lido = contextoSchema.safeParse(bruto);
  const d = lido.success ? lido.data : {};
  return {
    platformPostId: d.platform_post_id ?? null,
    postId: d.post_id ?? null,
    permalink: d.permalink ?? null,
    textoDoPost: d.post_text ?? null,
    imagemDoPost: d.post_image_url ?? null,
    ehAnuncio: d.is_ad ?? false,
    tituloDoAnuncio: d.ad_title ?? null,
    fechamento: d.fechamento ?? null,
  };
}

const mensagemSchema = z
  .object({
    parent_comment_id: textoOuNulo,
    platform_post_id: textoOuNulo,
    origem: z.enum(["app", "crm"]).nullish().transform((v) => v ?? null),
    modo: z.enum(["publico", "privado"]).nullish().transform((v) => v ?? null),
    reply_to_comment_id: textoOuNulo,
    private_reply: z.enum(["usada"]).nullish().transform((v) => v ?? null),
  })
  .partial();

export interface ComentarioDaMensagem {
  parentCommentId: string | null;
  platformPostId: string | null;
  /** Saída: `app` = respondido pelo celular; `crm` = pelo CRM. */
  origem: "app" | "crm" | null;
  /** Saída pelo CRM: no post (`publico`) ou no Direct (`privado`). */
  modo: "publico" | "privado" | null;
  replyToCommentId: string | null;
  /** Entrada: a única resposta privada que a Meta permite já foi gasta. */
  respostaPrivadaUsada: boolean;
}

export function lerComentarioDaMensagem(metadata: unknown): ComentarioDaMensagem | null {
  const bruto = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).comentario : null;
  if (!bruto || typeof bruto !== "object") return null;
  const lido = mensagemSchema.safeParse(bruto);
  const d = lido.success ? lido.data : {};
  return {
    parentCommentId: d.parent_comment_id ?? null,
    platformPostId: d.platform_post_id ?? null,
    origem: d.origem ?? null,
    modo: d.modo ?? null,
    replyToCommentId: d.reply_to_comment_id ?? null,
    respostaPrivadaUsada: d.private_reply === "usada",
  };
}

/** A Meta aceita a resposta no Direct até 7 dias depois do comentário. */
export const JANELA_DA_RESPOSTA_PRIVADA_MS = 7 * 24 * 60 * 60 * 1000;

export function respostaPrivadaDisponivel(
  comentario: { criadoEm: string | null; metadata: unknown },
  agora = Date.now(),
): boolean {
  const lido = lerComentarioDaMensagem(comentario.metadata);
  if (lido?.respostaPrivadaUsada) return false;
  if (!comentario.criadoEm) return false;
  return agora - Date.parse(comentario.criadoEm) < JANELA_DA_RESPOSTA_PRIVADA_MS;
}
