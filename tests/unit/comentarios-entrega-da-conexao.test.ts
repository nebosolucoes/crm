import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mudarEntregaDaConexao } from "@/lib/channels/social";
import { atualizarEventosDoWebhook, eventosDaConexao } from "@/lib/channels/zernio/social";

/**
 * Spec 22 §4 — o que a conexão entrega para a inbox decide os eventos do
 * webhook, e mudar a escolha nunca deixa a tela dizendo uma coisa e o
 * provedor fazendo outra.
 */

type Chamada = { url: string; metodo: string; corpo: Record<string, unknown> | null };

let chamadas: Chamada[] = [];
let respostaDoProvedor = 200;

beforeEach(() => {
  chamadas = [];
  respostaDoProvedor = 200;
  vi.stubEnv("ZERNIO_API_KEY", "sk-teste");
  vi.stubEnv("ZERNIO_API_BASE_URL", "https://zernio.test/api");
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    chamadas.push({
      url,
      metodo: init?.method ?? "GET",
      corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    return new Response(JSON.stringify(respostaDoProvedor < 300 ? { success: true } : { error: "recusado" }), {
      status: respostaDoProvedor,
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Dublê do client: devolve a linha da sessão e guarda os updates. */
function adminCom(linha: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const ordem: string[] = [];
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    is: () => consulta,
    maybeSingle: async () => ({ data: linha, error: null }),
  };
  const client = {
    from: () => ({
      select: () => consulta,
      update: (valores: Record<string, unknown>) => {
        updates.push(valores);
        ordem.push("banco");
        const fim = { eq: () => fim, then: (ok: (v: { error: null }) => unknown) => ok({ error: null }) };
        return fim;
      },
    }),
  };
  return { client: client as never, updates, ordem };
}

const sessaoInstagram = (entrega: { direct: boolean; comentarios: boolean }) => ({
  provider: "zernio",
  platform: "instagram",
  metadata: { zernio_webhook_id: "wh-1" },
  inbox_direct: entrega.direct,
  inbox_comments: entrega.comentarios,
});

describe("eventos do webhook por escolha", () => {
  it("só Direct: mensagens e conta, sem comentário", () => {
    const e = eventosDaConexao({ direct: true, comentarios: false });
    expect(e).toContain("message.received");
    expect(e).not.toContain("comment.received");
    expect(e).toContain("account.disconnected");
  });

  it("só comentários: comentário e conta, sem mensagem", () => {
    const e = eventosDaConexao({ direct: false, comentarios: true });
    expect(e).toEqual(["comment.received", "account.connected", "account.disconnected"]);
  });

  it("os dois: tudo", () => {
    const e = eventosDaConexao({ direct: true, comentarios: true });
    expect(e).toContain("message.received");
    expect(e).toContain("comment.received");
  });
});

describe("atualizarEventosDoWebhook", () => {
  it("manda PUT só com o id e os eventos — segredo e URL não mudam", async () => {
    const r = await atualizarEventosDoWebhook("sk-teste", { webhookId: "wh-1", entrega: { direct: false, comentarios: true } });
    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.metodo).toBe("PUT");
    expect(chamadas[0]?.url).toBe("https://zernio.test/api/v1/webhooks/settings");
    expect(chamadas[0]?.corpo).toEqual({ webhookId: "wh-1", events: ["comment.received", "account.connected", "account.disconnected"] });
  });

  it("recusa do provedor vira motivo", async () => {
    respostaDoProvedor = 403;
    const r = await atualizarEventosDoWebhook("sk-teste", { webhookId: "wh-1", entrega: { direct: true, comentarios: true } });
    expect(r.ok).toBe(false);
  });
});

describe("mudarEntregaDaConexao — a tela nunca mente", () => {
  const entrada = (entrega: { direct: boolean; comentarios: boolean }) => ({
    organizationId: "org-1",
    sessionId: "sess-1",
    entrega,
  });

  it("LIGAR comentários: provedor primeiro, banco depois", async () => {
    const { client, updates } = adminCom(sessaoInstagram({ direct: true, comentarios: false }));
    const r = await mudarEntregaDaConexao(client, entrada({ direct: true, comentarios: true }));
    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => c.metodo)).toEqual(["PUT"]);
    expect(updates).toEqual([{ inbox_direct: true, inbox_comments: true }]);
  });

  it("LIGAR com o provedor recusando: nada gravado", async () => {
    respostaDoProvedor = 500;
    const { client, updates } = adminCom(sessaoInstagram({ direct: true, comentarios: false }));
    const r = await mudarEntregaDaConexao(client, entrada({ direct: true, comentarios: true }));
    expect(r.ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("DESLIGAR com o provedor recusando: grava mesmo assim (a entrada filtra)", async () => {
    respostaDoProvedor = 500;
    const { client, updates } = adminCom(sessaoInstagram({ direct: true, comentarios: true }));
    const r = await mudarEntregaDaConexao(client, entrada({ direct: true, comentarios: false }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.provedorAtualizado).toBe(false);
    expect(updates).toEqual([{ inbox_direct: true, inbox_comments: false }]);
  });

  it("nada a entregar é recusado antes de tocar em qualquer coisa", async () => {
    const { client, updates } = adminCom(sessaoInstagram({ direct: true, comentarios: true }));
    const r = await mudarEntregaDaConexao(client, entrada({ direct: false, comentarios: false }));
    expect(r.ok).toBe(false);
    expect(chamadas).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("conexão de WhatsApp não escolhe", async () => {
    const { client, updates } = adminCom({ provider: "waha", platform: "whatsapp", metadata: {}, inbox_direct: true, inbox_comments: false });
    const r = await mudarEntregaDaConexao(client, entrada({ direct: true, comentarios: true }));
    expect(r.ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("conexão de outra organização (ou inexistente) é 'não encontrada'", async () => {
    const { client } = adminCom(null);
    const r = await mudarEntregaDaConexao(client, entrada({ direct: true, comentarios: true }));
    expect(r).toEqual({ ok: false, motivo: "Conexão não encontrada." });
  });
});
