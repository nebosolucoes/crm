import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { ingerirComentario } from "@/lib/channels/comentarios/ingest";
import { parseZernioComentario } from "@/lib/channels/zernio/comentarios";

/**
 * Spec 22 §3 — `comment.received` vira atendimento.
 *
 * O dublê é um banco em memória que APLICA os filtros (`eq`, `neq`, `gte`) e
 * as regras que importam aqui: `unique (organization_id, external_id)` em
 * mensagens devolve 23505, e o fio de comentário é único por raiz. Um dublê que
 * só registra chamadas afirmaria que o código PERGUNTOU, não que achou.
 */

type Linha = Record<string, unknown>;
const ORG = "org-1";
const SESSAO = "sess-ig";

let tabelas: Record<string, Linha[]>;
let seq = 0;
let statusChamados: { conv: string; status: string }[];

function novoId(prefixo: string): string {
  seq += 1;
  return `${prefixo}-${seq}`;
}

function consulta(nome: string) {
  const filtros: ((l: Linha) => boolean)[] = [];
  let limite = Infinity;
  let modo: "select" | "update" | "insert" = "select";
  let valores: Linha | null = null;
  const linhas = () => (tabelas[nome] ??= []);
  const casadas = () => linhas().filter((l) => filtros.every((f) => f(l))).slice(0, limite);

  const resolver = (): { data: unknown; error: { code?: string; message: string } | null } => {
    if (modo === "insert" && valores) {
      if (nome === "messages" && linhas().some((l) => l.organization_id === valores?.organization_id && l.external_id === valores?.external_id)) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      const linha = { id: novoId(nome), created_at: new Date().toISOString(), ...valores };
      linhas().push(linha);
      return { data: linha, error: null };
    }
    if (modo === "update" && valores) {
      const alvo = casadas();
      for (const l of alvo) Object.assign(l, valores);
      return { data: alvo, error: null };
    }
    return { data: casadas(), error: null };
  };

  const q: Record<string, unknown> = {
    select: () => q,
    insert: (v: Linha) => {
      modo = "insert";
      valores = v;
      return q;
    },
    update: (v: Linha) => {
      modo = "update";
      valores = v;
      return q;
    },
    eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
    neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
    gte: (c: string, v: string) => (filtros.push((l) => String(l[c] ?? "") >= v), q),
    is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
    limit: (n: number) => ((limite = n), q),
    maybeSingle: async () => {
      const r = resolver();
      if (r.error) return r;
      const d = r.data;
      return { data: Array.isArray(d) ? (d[0] ?? null) : d, error: null };
    },
    then: (ok: (v: unknown) => unknown) => ok(resolver()),
  };
  return q;
}

const rpc = async (nome: string, a: Record<string, unknown>) => {
  switch (nome) {
    case "fn_upsert_social_contact": {
      const ids = (tabelas.identidades ??= []);
      const achou = ids.find((i) => i.user === a.p_user_id);
      if (achou) return { data: achou.contact, error: null };
      const contact = novoId("contato");
      ids.push({ user: a.p_user_id, contact });
      return { data: contact, error: null };
    }
    case "fn_upsert_comment_conversation": {
      const convs = (tabelas.conversations ??= []);
      const achou = convs.find(
        (c) => c.kind === "comment" && c.channel_session_id === a.p_session && c.provider_conversation_id === a.p_root_comment_id,
      );
      if (achou) return { data: achou.id, error: null };
      const id = novoId("fio");
      convs.push({
        id,
        organization_id: a.p_org,
        contact_id: a.p_contact,
        channel_session_id: a.p_session,
        kind: "comment",
        provider_conversation_id: a.p_root_comment_id,
        status: "open",
        service_revision: 1,
        service_closed_at: null,
        metadata: { comentario: a.p_contexto },
      });
      return { data: id, error: null };
    }
    case "fn_service_status": {
      const c = (tabelas.conversations ?? []).find((x) => x.id === a.p_conversation);
      if (!c) return { data: null, error: { message: "service_not_found" } };
      statusChamados.push({ conv: c.id as string, status: a.p_status as string });
      c.status = a.p_status;
      if (a.p_status === "closed") c.service_closed_at = new Date().toISOString();
      c.service_revision = (c.service_revision as number) + 1;
      return { data: c, error: null };
    }
    default:
      return { data: null, error: null };
  }
};

const admin = { from: (t: string) => consulta(t), rpc } as never;

function evento(comment: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: `evt-${String(comment.id)}`,
    event: "comment.received",
    comment: {
      platformPostId: "post-1",
      postId: null,
      platform: "instagram",
      text: "Quanto custa?",
      createdAt: new Date().toISOString(),
      isReply: false,
      parentCommentId: null,
      author: { id: "igsid-cliente", username: "cliente", name: "Cliente", isOwnAccount: false },
      ...comment,
    },
    post: { platformPostId: "post-1", content: "Promoção", imageUrl: null, permalink: "https://instagram.com/p/x", id: null },
    account: { id: "acc-1", accountId: "acc-1", platform: "instagram", username: "certoatacado" },
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

const sessao = { plataforma: "instagram", accountId: "acc-1", recebeComentarios: true };
const ingerir = (payload: unknown, s = sessao) =>
  ingerirComentario(admin, { organizationId: ORG, channelSessionId: SESSAO, payload, sessao: s });

beforeEach(() => {
  tabelas = {};
  seq = 0;
  statusChamados = [];
});

describe("parseZernioComentario", () => {
  it("lê o comentário, o post e a conta", () => {
    const c = parseZernioComentario(evento({ id: "c1" }));
    expect(c).toMatchObject({
      commentId: "c1",
      platformPostId: "post-1",
      plataforma: "instagram",
      texto: "Quanto custa?",
      ehResposta: false,
      autor: { id: "igsid-cliente", ehDaConta: false },
      post: { permalink: "https://instagram.com/p/x" },
      contas: ["acc-1", "acc-1"],
    });
  });

  it("facebook vira messenger (a sessão social do Facebook)", () => {
    expect(parseZernioComentario(evento({ id: "c1", platform: "facebook" }))?.plataforma).toBe("messenger");
  });

  it("isOwnAccount ausente é 'não avaliado', não 'não é a conta'", () => {
    const c = parseZernioComentario(evento({ id: "c1", author: { id: "x" } }));
    expect(c?.autor.ehDaConta).toBeNull();
  });

  it("recusa rede que o CRM não atende e evento sem id", () => {
    expect(parseZernioComentario(evento({ id: "c1", platform: "youtube" }))).toBeNull();
    expect(parseZernioComentario(evento({ id: null }))).toBeNull();
    expect(parseZernioComentario({ event: "message.received" })).toBeNull();
  });

  it("anúncio e sticker do Facebook", () => {
    const c = parseZernioComentario(
      evento({ id: "c1", platform: "facebook", text: "", ad: { promotionStatus: "active" }, attachment: { type: "sticker", imageUrl: "https://cdn/x.png" } }),
    );
    expect(c?.anuncio?.promocao).toBe("active");
    expect(c?.anexo).toEqual({ tipo: "sticker", imagemUrl: "https://cdn/x.png", url: null });
  });
});

describe("comentário de cliente", () => {
  it("abre um fio pela raiz, com a mensagem e o contexto do post", async () => {
    const r = await ingerir(evento({ id: "raiz-1" }));
    expect(r.status).toBe("ingested");
    const fio = tabelas.conversations?.[0];
    expect(fio).toMatchObject({ kind: "comment", provider_conversation_id: "raiz-1", status: "open" });
    expect((fio?.metadata as { comentario: { permalink: string } }).comentario.permalink).toBe("https://instagram.com/p/x");
    expect(tabelas.messages?.[0]).toMatchObject({ external_id: "raiz-1", direction: "inbound", body: "Quanto custa?" });
  });

  it("reentrega do mesmo evento é duplicate e não grava de novo", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    const r = await ingerir(evento({ id: "raiz-1" }));
    expect(r.status).toBe("duplicate");
    expect(tabelas.messages).toHaveLength(1);
  });

  it("dois comentários principais = dois atendimentos (decisão 1)", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    await ingerir(evento({ id: "raiz-2" }));
    expect(tabelas.conversations).toHaveLength(2);
  });

  it("a tréplica do cliente entra no MESMO fio", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    const r = await ingerir(evento({ id: "treplica", isReply: true, parentCommentId: "raiz-1", text: "E o frete?" }));
    expect(r.conversationId).toBe(tabelas.conversations?.[0]?.id);
    expect(tabelas.conversations).toHaveLength(1);
    expect(tabelas.messages).toHaveLength(2);
  });

  it("resposta a uma resposta (Facebook aninha) acha o fio pela mensagem do pai", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    await ingerir(evento({ id: "nivel-2", isReply: true, parentCommentId: "raiz-1" }));
    const r = await ingerir(evento({ id: "nivel-3", isReply: true, parentCommentId: "nivel-2" }));
    expect(r.conversationId).toBe(tabelas.conversations?.[0]?.id);
    expect(tabelas.conversations).toHaveLength(1);
  });

  it("resposta a um comentário que nunca entrou abre o fio pelo pai", async () => {
    const r = await ingerir(evento({ id: "filho", isReply: true, parentCommentId: "pai-antigo" }));
    expect(r.status).toBe("ingested");
    expect(tabelas.conversations?.[0]?.provider_conversation_id).toBe("pai-antigo");
  });

  it("comentário novo num fio fechado reabre o atendimento", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    const fio = tabelas.conversations?.[0] as Linha;
    fio.status = "closed";
    fio.service_closed_at = new Date(Date.now() - 60_000).toISOString();
    await ingerir(evento({ id: "de-novo", isReply: true, parentCommentId: "raiz-1" }));
    expect(fio.status).toBe("open");
  });

  it("reentrega atrasada de um comentário ANTERIOR ao fechamento não reabre", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    const fio = tabelas.conversations?.[0] as Linha;
    fio.status = "closed";
    fio.service_closed_at = new Date().toISOString();
    await ingerir(
      evento({ id: "velho", isReply: true, parentCommentId: "raiz-1", createdAt: new Date(Date.now() - 3_600_000).toISOString() }),
    );
    expect(fio.status).toBe("closed");
  });
});

describe("resposta da própria conta", () => {
  const daConta = (id: string, extra: Record<string, unknown> = {}) =>
    evento({
      id,
      isReply: true,
      parentCommentId: "raiz-1",
      text: "Custa R$ 50",
      author: { id: "conta", username: "certoatacado", isOwnAccount: true },
      ...extra,
    });

  it("respondido pelo app do celular FECHA o atendimento", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    const r = await ingerir(daConta("resposta-app"));
    expect(r.status).toBe("closed");
    expect(r.reason).toBe("respondido_pelo_app");
    expect(tabelas.conversations?.[0]?.status).toBe("closed");
    const fechamento = (tabelas.conversations?.[0]?.metadata as { comentario: { fechamento: { motivo: string } } }).comentario.fechamento;
    expect(fechamento.motivo).toBe("respondido_pelo_app");
    expect(tabelas.messages?.[1]).toMatchObject({ direction: "outbound", sent_via: "external_device" });
  });

  it("eco do que o CRM respondeu (mesmo id) não fecha nem duplica", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    tabelas.messages?.push({
      id: "nossa",
      organization_id: ORG,
      conversation_id: tabelas.conversations?.[0]?.id,
      external_id: "resposta-crm",
      direction: "outbound",
      sent_via: "crm",
      body: "Custa R$ 50",
      created_at: new Date().toISOString(),
    });
    const r = await ingerir(daConta("resposta-crm"));
    expect(r.status).toBe("duplicate");
    expect(statusChamados).toEqual([]);
  });

  it("eco com id diferente (mesmo texto, 10 min) também é duplicate", async () => {
    await ingerir(evento({ id: "raiz-1" }));
    tabelas.messages?.push({
      id: "nossa",
      organization_id: ORG,
      conversation_id: tabelas.conversations?.[0]?.id,
      external_id: "id-do-envio",
      direction: "outbound",
      sent_via: "crm",
      body: "Custa R$ 50",
      created_at: new Date().toISOString(),
    });
    const r = await ingerir(daConta("id-do-eco"));
    expect(r.status).toBe("duplicate");
  });

  it("a marca comentando no próprio post não abre atendimento", async () => {
    const r = await ingerir(evento({ id: "post-da-marca", author: { id: "conta", isOwnAccount: true } }));
    expect(r.status).toBe("ignored");
    expect(tabelas.conversations ?? []).toHaveLength(0);
  });
});

describe("guardas da sessão", () => {
  it("comentários desligados na conexão: nada gravado", async () => {
    const r = await ingerir(evento({ id: "raiz-1" }), { ...sessao, recebeComentarios: false });
    expect(r).toMatchObject({ status: "ignored", reason: "comentarios_desligados" });
    expect(tabelas.messages ?? []).toHaveLength(0);
  });

  it("conta de outra sessão é recusada", async () => {
    const r = await ingerir(evento({ id: "raiz-1" }), { ...sessao, accountId: "acc-outra" });
    expect(r.reason).toBe("conta_de_outra_sessao");
  });

  it("rede de outra sessão é recusada", async () => {
    const r = await ingerir(evento({ id: "raiz-1", platform: "facebook" }));
    expect(r.reason).toBe("rede_de_outra_sessao");
  });
});
