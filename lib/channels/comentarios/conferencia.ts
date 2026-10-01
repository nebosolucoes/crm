/**
 * A CONFERÊNCIA: o comentário que o webhook não entregou entra mesmo assim
 * (spec 22 §8, laço de retorno).
 *
 * Webhook falha — o endpoint ficou fora do ar, a entrega esgotou as
 * retentativas, a conta reconectou e o webhook velho caiu. Sem conferência, o
 * comentário perdido nunca vira atendimento e nada avisa: o cliente fica sem
 * resposta no post, à vista de todos, e a inbox diz que está tudo em dia.
 *
 * Para cada conexão que recebe comentários: os posts mais recentes da conta
 * (`GET /v1/inbox/comments`), e de cada um os comentários
 * (`GET /v1/inbox/comments/{postId}`). O que for das últimas horas passa pela
 * MESMA ingestão do webhook — o dedupe por `external_id` faz a reentrega do
 * que já entrou não custar nada. Anúncio fica de fora: a lista dele exige o
 * add-on de anúncios, e o webhook já o entrega.
 *
 * Limites conscientes: a listagem da Zernio tem cache de até 10 minutos, então
 * a conferência ATRASA, não substitui o webhook; e olha só os posts mais novos,
 * onde mora quase todo comentário.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { resolveZernioCreds } from "../zernio/credentials";
import { ingerirComentario } from "./ingest";

/** Comentários mais velhos que isto não são buscados: a conferência é rede, não importação. */
export const JANELA_DA_CONFERENCIA_MS = 3 * 60 * 60 * 1000;
const POSTS_POR_CONTA = 10;
const CONTAS_POR_RODADA = 50;

type Json = Record<string, unknown>;
type Buscar = (url: string, init: RequestInit) => Promise<Response>;

export interface ResultadoDaConferencia {
  contas: number;
  recuperados: number;
  falhas: number;
}

interface ComentarioListado {
  id?: string;
  message?: string;
  createdTime?: string;
  from?: { id?: string; name?: string; username?: string; picture?: string | null; isOwner?: boolean };
  parentId?: string;
  replies?: ComentarioListado[];
}

export async function conferirComentarios(
  admin: SupabaseClient,
  opcoes: { agora?: number; buscar?: Buscar } = {},
): Promise<ResultadoDaConferencia> {
  const agora = opcoes.agora ?? Date.now();
  const buscar: Buscar = opcoes.buscar ?? ((url, init) => fetch(url, init));
  const desde = agora - JANELA_DA_CONFERENCIA_MS;

  const { data: sessoes } = await admin
    .from("channel_sessions")
    .select("id, organization_id, platform, zernio_account_id")
    .eq("inbox_comments", true)
    .is("archived_at", null)
    .not("zernio_account_id", "is", null)
    .limit(CONTAS_POR_RODADA);

  const r: ResultadoDaConferencia = { contas: 0, recuperados: 0, falhas: 0 };

  for (const s of sessoes ?? []) {
    const organizationId = s.organization_id as string;
    const accountId = s.zernio_account_id as string;
    const plataforma = s.platform as string;
    const creds = await resolveZernioCreds(admin, { organizationId, accountId });
    if (!creds) continue;
    r.contas += 1;
    const cabecalhos = { Authorization: `Bearer ${creds.apiKey}` };

    try {
      const posts = await lerJson(
        buscar(
          `${creds.baseUrl}/v1/inbox/comments?accountId=${encodeURIComponent(accountId)}&sortBy=date&sortOrder=desc&limit=${POSTS_POR_CONTA}`,
          { headers: cabecalhos, signal: AbortSignal.timeout(20_000) },
        ),
      );
      const lista = Array.isArray(posts?.data) ? (posts.data as Json[]) : [];

      for (const post of lista) {
        if (post.isAd === true || !(Number(post.commentCount) > 0) || typeof post.id !== "string") continue;
        const comentarios = await lerJson(
          buscar(
            `${creds.baseUrl}/v1/inbox/comments/${encodeURIComponent(post.id)}?accountId=${encodeURIComponent(accountId)}&limit=50`,
            { headers: cabecalhos, signal: AbortSignal.timeout(20_000) },
          ),
        );
        const raiz = Array.isArray(comentarios?.comments) ? (comentarios.comments as ComentarioListado[]) : [];

        // Pai antes do filho: a resposta precisa achar o fio que o pai abriu.
        for (const c of achatar(raiz)) {
          if (!c.id || !c.createdTime || Date.parse(c.createdTime) < desde) continue;
          const payload = {
            event: "comment.received",
            comment: {
              id: c.id,
              platformPostId: post.id,
              platform: plataforma === "messenger" ? "facebook" : plataforma,
              text: c.message ?? "",
              createdAt: c.createdTime,
              isReply: Boolean(c.parentId),
              parentCommentId: c.parentId ?? null,
              author: {
                id: c.from?.id,
                username: c.from?.username,
                name: c.from?.name,
                picture: c.from?.picture ?? null,
                ...(typeof c.from?.isOwner === "boolean" ? { isOwnAccount: c.from.isOwner } : {}),
              },
            },
            post: {
              platformPostId: post.id,
              content: typeof post.content === "string" ? post.content : null,
              imageUrl: typeof post.picture === "string" ? post.picture : null,
              permalink: typeof post.permalink === "string" ? post.permalink : null,
            },
            account: { id: accountId, accountId },
          };
          const res = await ingerirComentario(admin, {
            organizationId,
            channelSessionId: s.id as string,
            payload,
            sessao: { plataforma, accountId, recebeComentarios: true },
          });
          if (res.status === "ingested" || res.status === "closed") r.recuperados += 1;
        }
      }
    } catch (err) {
      r.falhas += 1;
      logger.warn("[comentarios] conferência da conta falhou", {
        sessao: s.id,
        detail: err instanceof Error ? err.message.slice(0, 160) : "unknown",
      });
    }
  }
  return r;
}

/** Comentário e respostas numa lista só, cada resposta depois do seu pai. */
function achatar(lista: ComentarioListado[], pai: string | null = null): ComentarioListado[] {
  const out: ComentarioListado[] = [];
  for (const c of lista) {
    out.push(pai && !c.parentId ? { ...c, parentId: pai } : c);
    if (Array.isArray(c.replies) && c.id) out.push(...achatar(c.replies, c.id));
  }
  return out;
}

async function lerJson(p: Promise<Response>): Promise<Json | null> {
  const res = await p;
  if (!res.ok) throw new Error(`provedor_respondeu_${res.status}`);
  return (await res.json().catch(() => null)) as Json | null;
}
