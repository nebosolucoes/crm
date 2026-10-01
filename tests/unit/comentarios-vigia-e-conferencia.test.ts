import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/zernio/credentials", () => ({
  resolveZernioCreds: async () => ({ accountId: "acc-1", apiKey: "sk", baseUrl: "https://zernio.test/api", source: "env" }),
}));

import { conferirComentarios } from "@/lib/channels/comentarios/conferencia";
import { vigiarComentariosParados } from "@/lib/channels/comentarios/vigia";

import { bancoEmMemoria } from "./helpers/banco-em-memoria";

/**
 * Spec 22 §8 — nenhum comentário sem resposta: o aviso por conta que abre,
 * se atualiza e FECHA sozinho; e a conferência que traz o que o webhook perdeu.
 */

const AGORA = Date.parse("2026-10-01T12:00:00Z");
const horasAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();

function fio(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: "org-1",
    channel_session_id: "sess-ig",
    kind: "comment",
    status: "open",
    last_inbound_at: horasAtras(6),
    last_outbound_at: null,
    ...extra,
  };
}

function banco(conversas: Record<string, unknown>[], settings: Record<string, unknown> = {}) {
  return bancoEmMemoria({
    tabelas: {
      conversations: conversas,
      organizations: [{ id: "org-1", settings }],
      channel_sessions: [{ id: "sess-ig", display_name: "@certoatacado" }],
      agent_inbox_items: [],
    },
  });
}

describe("vigia — comentário parado vira aviso por conta", () => {
  it("dois comentários parados há 6 h = UM aviso para a conta, com a contagem", async () => {
    const b = banco([fio("a"), fio("b", { last_inbound_at: horasAtras(5) })]);
    const r = await vigiarComentariosParados(b.client, AGORA);
    expect(r.avisosAbertos).toBe(1);
    const aviso = b.tabelas.agent_inbox_items?.[0];
    expect(aviso).toMatchObject({ kind: "comment_unanswered", ref_kind: "comment_queue", ref_id: "sess-ig", severity: "warn" });
    expect(aviso?.title).toBe("2 comentários sem resposta em @certoatacado");
    expect(String(aviso?.body)).toContain("há 6 horas");
  });

  it("dentro do prazo (4 h por padrão) não avisa", async () => {
    const b = banco([fio("a", { last_inbound_at: horasAtras(2) })]);
    expect((await vigiarComentariosParados(b.client, AGORA)).avisosAbertos).toBe(0);
  });

  it("o prazo da organização vale", async () => {
    const b = banco([fio("a", { last_inbound_at: horasAtras(2) })], { comentarios: { prazo_sem_resposta_horas: 1 } });
    expect((await vigiarComentariosParados(b.client, AGORA)).avisosAbertos).toBe(1);
  });

  it("respondido (nossa última depois da do cliente) não conta", async () => {
    const b = banco([fio("a", { last_outbound_at: horasAtras(1) })]);
    expect((await vigiarComentariosParados(b.client, AGORA)).avisosAbertos).toBe(0);
  });

  it("fechado e Direct não contam", async () => {
    const b = banco([fio("a", { status: "closed" }), fio("b", { kind: "direct" })]);
    expect((await vigiarComentariosParados(b.client, AGORA)).avisosAbertos).toBe(0);
  });

  it("segunda rodada não duplica: atualiza o mesmo aviso", async () => {
    const b = banco([fio("a")]);
    await vigiarComentariosParados(b.client, AGORA);
    b.tabelas.conversations?.push(fio("b"));
    const r = await vigiarComentariosParados(b.client, AGORA);
    expect(r).toMatchObject({ avisosAbertos: 0, avisosAtualizados: 1 });
    expect(b.tabelas.agent_inbox_items).toHaveLength(1);
    expect(b.tabelas.agent_inbox_items?.[0]?.title).toBe("2 comentários sem resposta em @certoatacado");
  });

  it("a fila zerou: o aviso FECHA sozinho", async () => {
    const b = banco([fio("a")]);
    await vigiarComentariosParados(b.client, AGORA);
    (b.tabelas.conversations?.[0] as Record<string, unknown>).status = "closed";
    const r = await vigiarComentariosParados(b.client, AGORA);
    expect(r.avisosFechados).toBe(1);
    expect(b.tabelas.agent_inbox_items?.[0]?.status).toBe("resolved");
  });
});

describe("conferência — o que o webhook perdeu entra mesmo assim", () => {
  const recente = horasAtras(1);
  const antigo = horasAtras(10);

  function respostas(comentarios: unknown[]) {
    return vi.fn(async (url: string) => {
      if (url.includes("/v1/inbox/comments?")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "post-1", commentCount: 3, content: "Promo", permalink: "https://ig/p/1", isAd: false },
              { id: "ad-1:instagram", commentCount: 9, isAd: true },
              { id: "post-sem", commentCount: 0 },
            ],
          }),
        );
      }
      return new Response(JSON.stringify({ comments: comentarios }));
    });
  }

  function bancoDaConferencia() {
    return bancoEmMemoria({
      tabelas: {
        channel_sessions: [
          { id: "sess-ig", organization_id: "org-1", platform: "instagram", zernio_account_id: "acc-1", inbox_comments: true, archived_at: null },
          { id: "sess-off", organization_id: "org-1", platform: "instagram", zernio_account_id: "acc-2", inbox_comments: false, archived_at: null },
        ],
      },
      unicos: { messages: [["organization_id", "external_id"]] },
      rpcs: {
        fn_upsert_social_contact: () => ({ data: "contato-1", error: null }),
        fn_upsert_comment_conversation: (a, t) => {
          const convs = (t.conversations ??= []);
          const achou = convs.find((c) => c.provider_conversation_id === a.p_root_comment_id);
          if (achou) return { data: achou.id, error: null };
          const id = `fio-${convs.length + 1}`;
          convs.push({
            id,
            organization_id: a.p_org,
            contact_id: a.p_contact,
            channel_session_id: a.p_session,
            kind: "comment",
            provider_conversation_id: a.p_root_comment_id,
            status: "open",
            metadata: { comentario: a.p_contexto },
          });
          return { data: id, error: null };
        },
        fn_service_status: (a, t) => {
          const c = (t.conversations ?? []).find((x) => x.id === a.p_conversation);
          if (c) c.status = a.p_status;
          return { data: c, error: null };
        },
      },
    });
  }

  it("recupera o comentário recente, ignora o antigo, o anúncio e a conta desligada", async () => {
    const b = bancoDaConferencia();
    const buscar = respostas([
      { id: "c-novo", message: "Tem M?", createdTime: recente, from: { id: "u1", username: "cliente" } },
      { id: "c-velho", message: "oi", createdTime: antigo, from: { id: "u2" } },
    ]);
    const r = await conferirComentarios(b.client, { agora: AGORA, buscar });
    expect(r).toMatchObject({ contas: 1, recuperados: 1, falhas: 0 });
    expect(b.tabelas.messages?.map((m) => m.external_id)).toEqual(["c-novo"]);
    expect(buscar.mock.calls.some(([url]) => String(url).includes("ad-1"))).toBe(false);
    expect(buscar.mock.calls.some(([url]) => String(url).includes("acc-2"))).toBe(false);
  });

  it("repetir a conferência não duplica (mesma ingestão, mesmo dedupe)", async () => {
    const b = bancoDaConferencia();
    const lista = [{ id: "c-novo", message: "Tem M?", createdTime: recente, from: { id: "u1" } }];
    await conferirComentarios(b.client, { agora: AGORA, buscar: respostas(lista) });
    const r = await conferirComentarios(b.client, { agora: AGORA, buscar: respostas(lista) });
    expect(r.recuperados).toBe(0);
    expect(b.tabelas.messages).toHaveLength(1);
  });

  it("resposta da conta achada na conferência fecha o fio (respondido pelo app, webhook perdido)", async () => {
    const b = bancoDaConferencia();
    await conferirComentarios(b.client, {
      agora: AGORA,
      buscar: respostas([
        {
          id: "c-novo",
          message: "Tem M?",
          createdTime: recente,
          from: { id: "u1" },
          replies: [{ id: "r-1", message: "Tem sim!", createdTime: recente, from: { id: "conta", isOwner: true } }],
        },
      ]),
    });
    expect(b.tabelas.conversations?.[0]?.status).toBe("closed");
  });

  it("provedor fora do ar conta como falha da conta, sem derrubar a rodada", async () => {
    const b = bancoDaConferencia();
    const r = await conferirComentarios(b.client, { agora: AGORA, buscar: async () => new Response("x", { status: 503 }) });
    expect(r).toMatchObject({ contas: 1, falhas: 1, recuperados: 0 });
  });
});
