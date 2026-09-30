/**
 * A API de posts do intermediário (`/v1/posts`, `/v1/media/presign`) — só o
 * transporte HTTP e a leitura da resposta. Quem decide o que mandar por
 * formato é `lib/channels/publicacao/social.ts`; quem decide o que fazer com o
 * desfecho é o worker de Publicações.
 *
 * Contrato lido do OpenAPI oficial em 30/09/2026 (`zernio.com/openapi.yaml`):
 *
 *  - `POST /v1/posts` com `publishNow: true` publica na hora; `201` criado,
 *    `207` criado com ≥1 plataforma falha (é sucesso HTTP: o detalhe está em
 *    `post.platforms[]`), `200` = replay de `Idempotency-Key`.
 *  - `Idempotency-Key` casa SÓ pela chave, por 24 h; em processamento devolve
 *    `409 idempotency_conflict` + `Retry-After`. Dedup por hash de conteúdo
 *    (plataforma, conta, texto + URLs) em 24 h devolve `409` com `existingPostId`.
 *  - `post.platforms[].status ∈ pending|processing|uploading|published|failed`,
 *    `platformPostId`, `platformPostUrl`, `errorMessage`, `errorCategory`.
 *  - `403 code ∈ ACCOUNT_DISCONNECTED|ACCOUNT_NOT_ENABLED_FOR_POSTING|PROFILE_OVER_LIMIT`.
 *  - Mídia: URL pública HTTPS que devolva o arquivo, ou `POST /v1/media/presign`
 *    (`uploadUrl` 1 h + `publicUrl` permanente) seguido de `PUT` do arquivo.
 */
import type { CategoriaDeFalha } from "../publicacao/contrato";
import { zernioApiKeyDaInstalacao, zernioBaseUrl } from "./credentials";

export type Json = Record<string, unknown>;

export interface RespostaHttp {
  status: number;
  json: Json | null;
  headers: Headers | null;
  /** `true` quando a chamada estourou o tempo ou a rede caiu antes de responder. */
  semResposta: boolean;
}

export const TIMEOUT_PADRAO_MS = 20_000;

export async function chamarPosts(
  apiKey: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  timeoutMs: number = TIMEOUT_PADRAO_MS,
): Promise<RespostaHttp> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${zernioBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const texto = await res.text();
    let json: Json | null = null;
    try {
      json = texto ? (JSON.parse(texto) as Json) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, headers: res.headers, semResposta: false };
  } catch {
    return { status: 0, json: null, headers: null, semResposta: true };
  } finally {
    clearTimeout(timer);
  }
}

export function apiKeyDePublicacao(): string | null {
  return zernioApiKeyDaInstalacao();
}

// ─── Leitura do post ────────────────────────────────────────────────────────

export interface DesfechoDaPlataforma {
  estado: "sent" | "accepted" | "failed" | "unknown";
  postId: string | null;
  platformPostId: string | null;
  url: string | null;
  providerStatus: string | null;
  codigo?: string;
  categoria?: CategoriaDeFalha;
  mensagem?: string;
}

/**
 * `errorCategory` do provedor → nossa classe. Transitório é só o que o
 * provedor mesmo diz ser passageiro; `unknown` conta como transitório porque
 * o custo de tentar de novo um post que não saiu é zero (a chave replica).
 */
export function categoriaDoProvedor(errorCategory: unknown): CategoriaDeFalha {
  switch (errorCategory) {
    case "platform_error":
    case "platform_rate_limit":
    case "system_error":
    case "unknown":
      return "transitorio";
    default:
      return "permanente";
  }
}

/** Lê `post.platforms[]` (a primeira entrada da rede pedida) de qualquer resposta que traga `post`. */
export function lerDesfechoDoPost(json: Json | null, platform: "instagram" | "facebook"): DesfechoDaPlataforma {
  const post = (json?.post ?? json) as Json | undefined;
  const postId = typeof post?._id === "string" ? post._id : typeof post?.id === "string" ? post.id : null;
  const plataformas = Array.isArray(post?.platforms) ? (post!.platforms as Json[]) : [];
  const alvo = plataformas.find((p) => p.platform === platform) ?? plataformas[0];
  if (!alvo) {
    const statusDoPost = typeof post?.status === "string" ? post.status : null;
    if (statusDoPost === "published") return { estado: "sent", postId, platformPostId: null, url: null, providerStatus: statusDoPost };
    if (statusDoPost === "failed") return { estado: "failed", postId, platformPostId: null, url: null, providerStatus: statusDoPost, codigo: "provider_failed", categoria: "permanente", mensagem: "O provedor marcou o post como falho." };
    return { estado: postId ? "accepted" : "unknown", postId, platformPostId: null, url: null, providerStatus: statusDoPost };
  }
  const status = typeof alvo.status === "string" ? alvo.status : null;
  const platformPostId = typeof alvo.platformPostId === "string" ? alvo.platformPostId : null;
  const url = typeof alvo.platformPostUrl === "string" ? alvo.platformPostUrl : null;
  if (status === "published") return { estado: "sent", postId, platformPostId, url, providerStatus: status };
  if (status === "failed" || status === "cancelled") {
    const mensagem = typeof alvo.errorMessage === "string" ? alvo.errorMessage : "O provedor não conseguiu publicar neste destino.";
    return {
      estado: "failed",
      postId,
      platformPostId,
      url,
      providerStatus: status,
      codigo: typeof alvo.errorCategory === "string" ? `provider_${alvo.errorCategory}` : "provider_failed",
      categoria: categoriaDoProvedor(alvo.errorCategory),
      mensagem,
    };
  }
  return { estado: postId ? "accepted" : "unknown", postId, platformPostId, url, providerStatus: status };
}

export function segundosDeRetryAfter(headers: Headers | null, json: Json | null): number | null {
  const h = headers?.get("retry-after");
  if (h && /^\d+$/.test(h)) return Number(h);
  const d = (json?.details as Json | undefined)?.retryAfterSeconds;
  return typeof d === "number" ? d : null;
}

// ─── Chamadas ───────────────────────────────────────────────────────────────

export function criarPost(apiKey: string, corpo: Json, idempotencyKey: string, timeoutMs: number): Promise<RespostaHttp> {
  return chamarPosts(apiKey, "POST", "/v1/posts", corpo, { "Idempotency-Key": idempotencyKey }, timeoutMs);
}

export function lerPost(apiKey: string, postId: string): Promise<RespostaHttp> {
  return chamarPosts(apiKey, "GET", `/v1/posts/${encodeURIComponent(postId)}`);
}

/**
 * Re-hospeda um arquivo no provedor: pede a URL de upload, sobe os bytes e
 * devolve a URL pública permanente. É o caminho de quem tem o Storage numa
 * rede que o provedor não alcança.
 */
export async function reHospedarMidia(
  apiKey: string,
  input: { filename: string; contentType: string; bytes: ArrayBuffer },
): Promise<{ ok: true; publicUrl: string } | { ok: false; codigo: string; categoria: CategoriaDeFalha; mensagem: string }> {
  const presign = await chamarPosts(apiKey, "POST", "/v1/media/presign", {
    filename: input.filename,
    contentType: input.contentType,
    size: input.bytes.byteLength,
  });
  if (presign.semResposta) return { ok: false, codigo: "provider_unreachable", categoria: "transitorio", mensagem: "O provedor não respondeu ao pedido de upload." };
  if (presign.status < 200 || presign.status >= 300) {
    const mensagem = typeof presign.json?.error === "string" ? presign.json.error : `Provedor respondeu ${presign.status} ao pedido de upload.`;
    return { ok: false, codigo: "media_rehost_refused", categoria: presign.status >= 500 ? "transitorio" : "permanente", mensagem };
  }
  const uploadUrl = presign.json?.uploadUrl;
  const publicUrl = presign.json?.publicUrl;
  if (typeof uploadUrl !== "string" || typeof publicUrl !== "string") {
    return { ok: false, codigo: "media_rehost_refused", categoria: "permanente", mensagem: "O provedor não devolveu a URL de upload." };
  }
  try {
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      body: input.bytes,
      signal: AbortSignal.timeout(120_000),
    });
    if (!put.ok) return { ok: false, codigo: "media_rehost_failed", categoria: "transitorio", mensagem: `Upload da mídia recusado (${put.status}).` };
  } catch {
    return { ok: false, codigo: "media_rehost_failed", categoria: "transitorio", mensagem: "Upload da mídia não terminou." };
  }
  return { ok: true, publicUrl };
}
