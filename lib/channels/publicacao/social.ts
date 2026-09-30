/**
 * Publicar em REDE SOCIAL (Instagram, Facebook) pelo intermediário: traduz o
 * pedido neutro (rede, formato, mídia, legenda, opções) para `POST /v1/posts`
 * com `publishNow`, e o desfecho do provedor para o contrato de publicação.
 *
 * ─── Decisões que moram aqui ────────────────────────────────────────────────
 *
 *  - O RELÓGIO é nosso: o post é criado na hora da ocorrência, com
 *    `publishNow: true`. Nada é agendado no provedor — cancelar e reagendar
 *    ficam no nosso banco, e a URL assinada de 10 minutos basta.
 *  - `Idempotency-Key` = a chave da execução. Estourou o tempo? Repete UMA vez
 *    com a mesma chave (o provedor replica o post original em vez de criar
 *    outro); estourou de novo, é `failed/transitorio` e o worker volta depois
 *    com a mesma chave.
 *  - Um post por pedido, uma rede por post. Instagram e Facebook da mesma
 *    publicação são dois pedidos, duas execuções, dois desfechos.
 *  - Mídia que o provedor não alcança (Storage na rede local) é re-hospedada
 *    pelo presign do provedor; mídia em URL pública vai como está.
 *  - Um vídeo único no Feed do Instagram sai como Reel — é a regra da rede, e
 *    a tela avisa antes.
 */
import { alcancavelPelaInternet } from "../url-publica";
import {
  apiKeyDePublicacao,
  criarPost,
  lerDesfechoDoPost,
  lerPost,
  reHospedarMidia,
  segundosDeRetryAfter,
  type Json,
} from "../zernio/posts";
import type {
  ConsultaDePublicacao,
  MidiaDoPedido,
  PedidoDePublicacao,
  PublishingAdapter,
  ResultadoDePublicacao,
} from "./contrato";

export const TIMEOUT_DE_PUBLICACAO_MS = 60_000;

function redeDoProvedor(network: PedidoDePublicacao["network"]): "instagram" | "facebook" | null {
  if (network === "instagram" || network === "facebook") return network;
  return null;
}

function tipoDaMidia(m: MidiaDoPedido): "image" | "video" | "gif" | "document" {
  if (m.kind === "image") return m.mime.toLowerCase() === "image/gif" ? "gif" : "image";
  if (m.kind === "video") return "video";
  return "document";
}

async function urlAlcancavel(
  apiKey: string,
  m: MidiaDoPedido,
): Promise<{ ok: true; url: string } | { ok: false; codigo: string; categoria: "transitorio" | "permanente"; mensagem: string }> {
  if (alcancavelPelaInternet(m.url)) return { ok: true, url: m.url };
  // O app enxerga o Storage (mesma rede); o provedor, não. Baixa aqui e sobe lá.
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(m.url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
    if (!res.ok) return { ok: false, codigo: "media_unreadable", categoria: "permanente", mensagem: `Não foi possível ler a mídia (${res.status}).` };
    bytes = await res.arrayBuffer();
  } catch {
    return { ok: false, codigo: "media_unreadable", categoria: "transitorio", mensagem: "Não foi possível ler a mídia para enviar ao provedor." };
  }
  const r = await reHospedarMidia(apiKey, { filename: m.filename ?? `midia.${m.mime.split("/")[1] ?? "bin"}`, contentType: m.mime, bytes });
  return r.ok ? { ok: true, url: r.publicUrl } : r;
}

/** O corpo do `POST /v1/posts` para um pedido — exportado para teste. */
export async function montarCorpoDoPost(
  pedido: PedidoDePublicacao,
  resolverUrl: (m: MidiaDoPedido) => Promise<string>,
): Promise<Json> {
  const platform = redeDoProvedor(pedido.network);
  if (!platform) throw new Error("rede_nao_social");
  const settings = pedido.settings ?? {};
  const mediaItems: Json[] = [];
  for (const m of pedido.media) {
    const url = await resolverUrl(m);
    const item: Json = { type: tipoDaMidia(m), url, mimeType: m.mime };
    if (m.filename) item.filename = m.filename;
    if (m.sizeBytes) item.size = m.sizeBytes;
    if (m.coverUrl && m.kind === "video") {
      const cover = await resolverUrl({ ...m, url: m.coverUrl, kind: "image", mime: "image/jpeg", coverUrl: null });
      if (platform === "instagram") item.instagramThumbnail = cover;
      else item.thumbnail = cover;
    }
    mediaItems.push(item);
  }

  const dados: Json = {};
  const ehStory = pedido.format === "story";
  if (ehStory) dados.contentType = "story";
  if (pedido.format === "reel") {
    if (platform === "facebook") {
      dados.contentType = "reel";
      if (typeof settings.title === "string" && settings.title) dados.title = settings.title;
    } else if (typeof settings.share_to_feed === "boolean") {
      dados.shareToFeed = settings.share_to_feed;
    }
  }
  if (!ehStory) {
    if (typeof settings.first_comment === "string" && settings.first_comment) dados.firstComment = settings.first_comment;
    if (typeof settings.comments_enabled === "boolean" && platform === "instagram") dados.commentsEnabled = settings.comments_enabled;
  }

  const legenda = ehStory ? null : (typeof settings.caption_override === "string" && settings.caption_override ? settings.caption_override : pedido.caption);
  const corpo: Json = {
    mediaItems,
    platforms: [{ platform, accountId: pedido.sessionRef, platformSpecificData: dados }],
    publishNow: true,
    metadata: { crm_execution_id: pedido.referencia, crm_format: pedido.format },
  };
  if (legenda && legenda.trim().length > 0) corpo.content = legenda;
  return corpo;
}

function falha(codigo: string, categoria: "transitorio" | "permanente", mensagem: string, extra: Partial<Extract<ResultadoDePublicacao, { estado: "failed" }>> = {}): ResultadoDePublicacao {
  return { estado: "failed", codigo, categoria, mensagem, ...extra };
}

export const publicadorSocial: PublishingAdapter = {
  async publish(pedido: PedidoDePublicacao): Promise<ResultadoDePublicacao> {
    const platform = redeDoProvedor(pedido.network);
    if (!platform) return falha("format_not_supported", "permanente", "Este canal não publica nesta rede.");
    const apiKey = apiKeyDePublicacao();
    if (!apiKey) return falha("provider_not_configured", "permanente", "A chave do provedor de redes sociais não está configurada nesta instalação.");

    let corpo: Json;
    try {
      corpo = await montarCorpoDoPost(pedido, async (m) => {
        const r = await urlAlcancavel(apiKey, m);
        if (!r.ok) throw Object.assign(new Error(r.mensagem), { codigo: r.codigo, categoria: r.categoria });
        return r.url;
      });
    } catch (err) {
      const e = err as { codigo?: string; categoria?: "transitorio" | "permanente"; message?: string };
      return falha(e.codigo ?? "media_unreadable", e.categoria ?? "permanente", e.message ?? "Não foi possível preparar a mídia.");
    }

    let res = await criarPost(apiKey, corpo, pedido.idempotencyKey, TIMEOUT_DE_PUBLICACAO_MS);
    if (res.semResposta) res = await criarPost(apiKey, corpo, pedido.idempotencyKey, TIMEOUT_DE_PUBLICACAO_MS);
    if (res.semResposta) return falha("provider_timeout", "transitorio", "O provedor não respondeu a tempo; a mesma chave será usada na próxima tentativa.");

    const json = res.json;
    if (res.status === 200 || res.status === 201 || res.status === 207 || res.status === 202) {
      const d = lerDesfechoDoPost(json, platform);
      if (d.estado === "sent" && d.postId) return { estado: "sent", externalId: d.postId, url: d.url, providerStatus: d.providerStatus, raw: json };
      if (d.estado === "accepted" && d.postId) return { estado: "accepted", externalId: d.postId, providerStatus: d.providerStatus, raw: json };
      if (d.estado === "failed") return falha(d.codigo ?? "provider_failed", d.categoria ?? "permanente", d.mensagem ?? "O provedor recusou a publicação.", { externalId: d.postId, raw: json });
      return falha("provider_response_invalid", "transitorio", "O provedor respondeu sem o post criado.", { raw: json });
    }
    const codigo = typeof json?.code === "string" ? json.code : null;
    const mensagem = typeof json?.error === "string" ? json.error : `Provedor respondeu ${res.status}.`;
    if (res.status === 409) {
      if (codigo === "idempotency_conflict") {
        const s = segundosDeRetryAfter(res.headers, json);
        return falha("idempotency_in_progress", "transitorio", "O provedor ainda processa a tentativa anterior.", { retryAfterMs: s ? s * 1000 : 30_000, raw: json });
      }
      const existente = (json?.details as Json | undefined)?.existingPostId;
      return falha("duplicate_content", "permanente", "O provedor já publicou este mesmo conteúdo e mídia nesta conta nas últimas 24 horas. Mude a legenda ou a mídia para publicar de novo.", {
        externalId: typeof existente === "string" ? existente : null,
        raw: json,
      });
    }
    if (res.status === 403) {
      if (codigo === "ACCOUNT_DISCONNECTED") return falha("account_disconnected", "permanente", "A conta foi desconectada no provedor. Reconecte em Conexões.", { raw: json });
      if (codigo === "ACCOUNT_NOT_ENABLED_FOR_POSTING") return falha("account_not_enabled_for_posting", "permanente", "Esta conexão não tem permissão para publicar. Reconecte em Conexões autorizando a publicação.", { raw: json });
      return falha("provider_forbidden", "permanente", mensagem, { raw: json });
    }
    if (res.status === 429) {
      const s = segundosDeRetryAfter(res.headers, json);
      return falha("rate_limited", "transitorio", "Limite de publicações do provedor atingido; tentando de novo mais tarde.", { retryAfterMs: s ? s * 1000 : 60_000, raw: json });
    }
    if (res.status === 401) return falha("provider_auth", "permanente", "A chave do provedor foi recusada.", { raw: json });
    if (res.status === 402) return falha("provider_payment_required", "permanente", "A conta no provedor tem um pagamento pendente.", { raw: json });
    if (res.status >= 500 || res.status === 503) return falha("provider_error", "transitorio", mensagem, { raw: json });
    return falha("invalid_request", "permanente", mensagem, { raw: json });
  },

  async consultar(input): Promise<ConsultaDePublicacao> {
    const apiKey = apiKeyDePublicacao();
    if (!apiKey) return { estado: "unknown", externalId: input.externalId };
    const res = await lerPost(apiKey, input.externalId);
    if (res.semResposta || res.status >= 500) return { estado: "unknown", externalId: input.externalId, raw: res.json };
    if (res.status === 404) return { estado: "failed", externalId: input.externalId, codigo: "post_not_found", categoria: "permanente", mensagem: "O provedor não encontra mais este post." };
    if (res.status < 200 || res.status >= 300) return { estado: "unknown", externalId: input.externalId, raw: res.json };
    // A leitura cai na primeira plataforma do post quando a pedida não está lá —
    // e um post nosso tem UMA plataforma, então "instagram" serve de chave neutra.
    const d = lerDesfechoDoPost(res.json, "instagram");
    return {
      estado: d.estado,
      externalId: input.externalId,
      url: d.url,
      providerStatus: d.providerStatus,
      codigo: d.codigo,
      categoria: d.categoria,
      mensagem: d.mensagem,
      raw: res.json,
    };
  },
};
