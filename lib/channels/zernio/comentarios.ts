/**
 * Leitura PURA do `comment.received` da Zernio (spec 22 §3). Nada de banco
 * aqui: o que decide (é comentário? de quem? em que fio?) se prova sem
 * Postgres; quem grava é `lib/channels/comentarios/ingest.ts`.
 *
 * Contrato (docs.zernio.com, webhooks › inbox, lido em 29/09/2026):
 *
 *   comment.{ id, postId, platformPostId, platform, text, createdAt, isReply,
 *             parentCommentId, author{ id, username, name, picture,
 *             isOwnAccount }, ad?{ id, title, promotionStatus },
 *             attachment?{ type, imageUrl, url } }   ← attachment só Facebook
 *   post.{ id, platformPostId, content, imageUrl, permalink }
 *   account.{ id, accountId, platform, username }
 *
 * `author.isOwnAccount` é o que fecha o atendimento quando alguém responde
 * pelo app: a Meta reentrega a resposta da própria conta como comentário.
 * AUSENTE quer dizer "não avaliado", nunca "não é a conta" (a doc insiste) —
 * por isso o campo é `true | false | null` e só `true` conta como resposta.
 */
import { PLATAFORMA_INSTAGRAM, PLATAFORMA_MESSENGER, type PlataformaSocial } from "../plataformas";

export interface ComentarioRecebido {
  /** Id do evento na Zernio — igual em toda reentrega. */
  eventoId: string | null;
  commentId: string;
  platformPostId: string;
  /** Id do post NA ZERNIO (null quando não foi publicado por ela). */
  postId: string | null;
  plataforma: PlataformaSocial;
  texto: string;
  criadoEm: string | null;
  ehResposta: boolean;
  parentCommentId: string | null;
  autor: {
    id: string;
    username: string | null;
    nome: string | null;
    foto: string | null;
    /** `true` = a própria conta conectada. `null` = a Zernio não avaliou. */
    ehDaConta: boolean | null;
  };
  post: {
    permalink: string | null;
    texto: string | null;
    imagemUrl: string | null;
  };
  anuncio: { id: string | null; titulo: string | null; promocao: string | null } | null;
  /** Só Facebook: sticker, GIF ou foto sem texto. URL efêmera. */
  anexo: { tipo: string; imagemUrl: string | null; url: string | null } | null;
  /** Contas citadas no evento — a ingestão confere contra a da sessão. */
  contas: string[];
}

type Bruto = Record<string, unknown>;

function obj(v: unknown): Bruto | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** `facebook` no fio é `messenger` no CRM: a sessão social do Facebook é a mesma. */
export function plataformaDoComentario(valor: unknown): PlataformaSocial | null {
  if (valor === "instagram") return PLATAFORMA_INSTAGRAM;
  if (valor === "facebook") return PLATAFORMA_MESSENGER;
  return null;
}

export function parseZernioComentario(payload: unknown): ComentarioRecebido | null {
  const p = obj(payload);
  if (!p || p.event !== "comment.received") return null;

  const c = obj(p.comment);
  if (!c) return null;
  const plataforma = plataformaDoComentario(c.platform);
  if (!plataforma) return null;

  const commentId = str(c.id);
  const platformPostId = str(c.platformPostId) ?? str(obj(p.post)?.platformPostId);
  const autor = obj(c.author);
  const autorId = str(autor?.id);
  if (!commentId || !platformPostId || !autorId) return null;

  const post = obj(p.post);
  const ad = obj(c.ad);
  const anexo = obj(c.attachment);
  const tipoDoAnexo = str(anexo?.type);
  const conta = obj(p.account);

  const ehResposta = c.isReply === true;
  return {
    eventoId: str(p.id),
    commentId,
    platformPostId,
    postId: str(c.postId) ?? str(post?.id),
    plataforma,
    texto: typeof c.text === "string" ? c.text : "",
    criadoEm: str(c.createdAt),
    ehResposta,
    parentCommentId: ehResposta ? str(c.parentCommentId) : null,
    autor: {
      id: autorId,
      username: str(autor?.username),
      nome: str(autor?.name),
      foto: str(autor?.picture),
      ehDaConta: typeof autor?.isOwnAccount === "boolean" ? autor.isOwnAccount : null,
    },
    post: {
      permalink: str(post?.permalink),
      texto: str(post?.content),
      imagemUrl: str(post?.imageUrl),
    },
    anuncio: ad ? { id: str(ad.id), titulo: str(ad.title), promocao: str(ad.promotionStatus) } : null,
    anexo: tipoDoAnexo ? { tipo: tipoDoAnexo, imagemUrl: str(anexo?.imageUrl), url: str(anexo?.url) } : null,
    contas: [str(conta?.accountId), str(conta?.id)].filter((v): v is string => v !== null),
  };
}

/**
 * O contexto do post que vai para `conversations.metadata.comentario` — o que a
 * tela mostra no topo do atendimento. Lido de volta só por
 * `lib/channels/comentarios/contexto.ts`.
 */
export function contextoDoPost(c: ComentarioRecebido): Record<string, unknown> {
  return {
    platform_post_id: c.platformPostId,
    post_id: c.postId,
    permalink: c.post.permalink,
    post_text: c.post.texto,
    post_image_url: c.post.imagemUrl,
    is_ad: c.anuncio !== null && (c.anuncio.id !== null || c.anuncio.promocao !== null),
    ad_title: c.anuncio?.titulo ?? null,
  };
}
