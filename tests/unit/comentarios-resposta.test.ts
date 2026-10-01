import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/zernio/credentials", () => ({
  resolveZernioCreds: async () => ({ accountId: "acc-1", apiKey: "sk-teste", baseUrl: "https://zernio.test/api", source: "env" }),
}));

import { zernioAdapter as ZernioAdapter } from "@/lib/channels/adapters/zernio";
import { prepararRespostaDeComentario } from "@/lib/channels/comentarios/resposta";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";

/**
 * Spec 22 §5.1 — responder comentário: no post ou no Direct, pelo endpoint
 * certo, e recusar ANTES de a linha nascer o que não cabe num comentário.
 */

type Chamada = { url: string; corpo: Record<string, unknown>; headers: Record<string, string> };
let chamadas: Chamada[] = [];
let resposta: { status: number; json: unknown } = { status: 200, json: {} };

beforeEach(() => {
  chamadas = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    chamadas.push({
      url,
      corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(resposta.json), { status: resposta.status });
  });
});

afterEach(() => vi.unstubAllGlobals());

const envelopeBase = {
  organizationId: "org-1",
  sessionRef: "acc-1",
  to: "raiz-1",
  providerConversationId: "raiz-1",
  kind: "text" as const,
  body: "Custa R$ 50",
};

describe("ZernioAdapter — resposta a comentário", () => {
  it("no post: POST /v1/inbox/comments/{post} com commentId, e o id devolvido vira o external_id", async () => {
    resposta = { status: 200, json: { success: true, data: { commentId: "resposta-1" } } };
    const r = await ZernioAdapter.send({
      ...envelopeBase,
      comentario: { platformPostId: "post-1", commentId: "c-1", modo: "publico", idempotencyKey: "msg-1" },
    });
    expect(r.externalId).toBe("resposta-1");
    expect(chamadas[0]?.url).toBe("https://zernio.test/api/v1/inbox/comments/post-1");
    expect(chamadas[0]?.corpo).toEqual({ accountId: "acc-1", message: "Custa R$ 50", commentId: "c-1" });
    expect(chamadas[0]?.headers["Idempotency-Key"]).toBe("msg-1");
  });

  it("no Direct: POST …/{post}/{comment}/private-reply, sem commentId no corpo", async () => {
    resposta = { status: 200, json: { status: "success", messageId: "mid-9", commentId: "c-1" } };
    const r = await ZernioAdapter.send({
      ...envelopeBase,
      comentario: { platformPostId: "post-1", commentId: "c-1", modo: "privado", idempotencyKey: "msg-2" },
    });
    expect(r.externalId).toBe("mid-9");
    expect(chamadas[0]?.url).toBe("https://zernio.test/api/v1/inbox/comments/post-1/c-1/private-reply");
    expect(chamadas[0]?.corpo).toEqual({ accountId: "acc-1", message: "Custa R$ 50" });
  });

  it("Direct já gasto pela Meta: o erro carrega o marcador para nunca repetir", async () => {
    resposta = { status: 400, json: { error: "used", code: "PRIVATE_REPLY", details: { privateReplyConsumed: true } } };
    await expect(
      ZernioAdapter.send({
        ...envelopeBase,
        comentario: { platformPostId: "post-1", commentId: "c-1", modo: "privado", idempotencyKey: "msg-3" },
      }),
    ).rejects.toThrow(/\[private_reply_consumed\]/);
  });

  it("sem comentário no envelope, o caminho de DM não muda", async () => {
    resposta = { status: 200, json: { success: true, data: { messageId: "dm-1" } } };
    await ZernioAdapter.send({ ...envelopeBase, providerConversationId: "thread-1" });
    expect(chamadas[0]?.url).toBe("https://zernio.test/api/v1/inbox/conversations/thread-1/messages");
  });
});

/** Dublê mínimo: devolve a linha pedida pela consulta de mensagens. */
function supabaseCom(alvo: Record<string, unknown> | null) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: alvo, error: null });
  return { from: () => q } as never;
}

const ctx = (tipo: "user" | "ai_agent" = "user") =>
  ({ organization_id: "org-1", requestId: "req-1", actor: { type: tipo, id: "u-1" } }) as unknown as HandlerCtx;

const conversa = {
  id: "conv-1",
  kind: "comment",
  provider_conversation_id: "raiz-1",
  metadata: { comentario: { platform_post_id: "post-1" } },
};

const texto = (extra: Partial<SendMessageInput> = {}) =>
  ({ conversation_id: "conv-1", type: "text", body: "Oi", ...extra }) as SendMessageInput;

const recente = new Date().toISOString();
const comentarioDoCliente = (meta: Record<string, unknown> = {}) => ({
  id: "msg-c",
  external_id: "c-9",
  direction: "inbound",
  sent_at: recente,
  created_at: recente,
  metadata: { comentario: meta },
});

describe("prepararRespostaDeComentario", () => {
  it("conversa de Direct: não é com ele", async () => {
    expect(await prepararRespostaDeComentario(supabaseCom(null), ctx(), { ...conversa, kind: "direct" }, texto(), null)).toBeNull();
  });

  it("responde o último comentário do cliente, no post por padrão", async () => {
    const r = await prepararRespostaDeComentario(supabaseCom(comentarioDoCliente()), ctx(), conversa, texto(), null);
    expect(r).toEqual({ platformPostId: "post-1", commentId: "c-9", alvoMessageId: "msg-c", modo: "publico" });
  });

  it("sem comentário no histórico, responde a raiz do fio", async () => {
    const r = await prepararRespostaDeComentario(supabaseCom(null), ctx(), conversa, texto(), null);
    expect(r?.commentId).toBe("raiz-1");
  });

  it("a IA não responde comentário (403)", async () => {
    await expect(prepararRespostaDeComentario(supabaseCom(null), ctx("ai_agent"), conversa, texto(), null)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("mídia é recusada (422)", async () => {
    await expect(
      prepararRespostaDeComentario(supabaseCom(null), ctx(), conversa, texto({ type: "image", media_url: "https://x/y.png" }), null),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("Direct já usado é recusado ANTES de sair", async () => {
    await expect(
      prepararRespostaDeComentario(
        supabaseCom(comentarioDoCliente({ private_reply: "usada" })),
        ctx(),
        conversa,
        texto({ comment_reply_mode: "private" }),
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("Direct passado de 7 dias é recusado", async () => {
    const velho = new Date(Date.now() - 8 * 24 * 3_600_000).toISOString();
    await expect(
      prepararRespostaDeComentario(
        supabaseCom({ ...comentarioDoCliente(), sent_at: velho, created_at: velho }),
        ctx(),
        conversa,
        texto({ comment_reply_mode: "private" }),
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("Direct dentro do prazo e não usado passa (controle positivo)", async () => {
    const r = await prepararRespostaDeComentario(
      supabaseCom(comentarioDoCliente()),
      ctx(),
      conversa,
      texto({ comment_reply_mode: "private" }),
      null,
    );
    expect(r?.modo).toBe("privado");
  });

  it("sem o post no contexto não dá para responder", async () => {
    await expect(
      prepararRespostaDeComentario(supabaseCom(null), ctx(), { ...conversa, metadata: {} }, texto(), null),
    ).rejects.toMatchObject({ status: 422 });
  });
});
