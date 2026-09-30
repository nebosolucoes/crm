import { describe, expect, it, vi } from "vitest";

import { argDe, cadeias, fakeAdmin, nomes, type Op } from "./_fake-admin";

const publish = vi.fn();
vi.mock("@/lib/channels/publicacao", () => ({ getPublisher: vi.fn(() => ({ publish })) }));
vi.mock("@/lib/channels/session-ref", () => ({ CHANNEL_SESSION_REF_COLUMNS: "session_name", resolveSessionRef: () => "sess" }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { executarExecucoesArrendadas } = await import("./executar");

const ORG = "22222222-2222-4222-8222-222222222222";
const AGORA = new Date("2026-09-30T22:31:00.000Z");
const WORKER = "req:w1";

function execucao(extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: "e1", organization_id: ORG, publication_id: "pub1", occurrence_id: "occ1", target_id: "t1",
    group_id: null, media_id: null, position: 0, attempt: 1, idempotency_key: "k1", metadata: {}, ...extra,
  };
}

interface Cenario {
  execucoes: Array<Record<string, unknown>>;
  sessao?: Record<string, unknown>;
  target?: Record<string, unknown>;
  medias?: Array<Record<string, unknown>>;
  grupos?: Array<Record<string, unknown>>;
}

function montar(c: Cenario) {
  const sessao = { id: "s1", provider: "x", platform: "whatsapp", status: "WORKING", archived_at: null, session_name: "sess", ...(c.sessao ?? {}) };
  const target = { id: "t1", network: "whatsapp", format: "group_message", channel_session_id: "s1", settings: {}, channel_sessions: sessao, ...(c.target ?? {}) };
  return fakeAdmin(
    (tabela: string, ops: Op[]): unknown => {
      const n = nomes(ops);
      if (tabela === "publications") return { data: { id: "pub1", title: "Oferta", body: "Coca 2L" }, error: null };
      if (tabela === "publication_targets") return { data: target, error: null };
      if (tabela === "publication_occurrences") return { data: { id: "occ1", scheduled_at: "2026-09-30T22:30:00.000Z" }, error: null };
      if (tabela === "publication_media") return { data: c.medias ?? [], error: null };
      if (tabela === "publication_target_groups") return { data: c.grupos ?? [], error: null };
      if (tabela === "publication_executions" && n[0] === "update") return { data: [{ id: "e1" }], error: null };
      if (tabela === "agent_inbox_items" && n[0] === "select") return { count: 0, error: null };
      return { data: null, error: null, count: 0 };
    },
    (fn) => (fn === "fn_claim_publication_executions" ? { data: c.execucoes, error: null } : { data: null, error: null }),
  );
}

const esperar = vi.fn(async () => {});

describe("executar — do claim ao desfecho", () => {
  it("sucesso: sending antes da chamada, sent com id externo depois, rollup da ocorrência", async () => {
    publish.mockReset().mockResolvedValue({ estado: "sent", externalId: "ext-1", url: null, externalIds: ["ext-1"] });
    const { admin, chamadas } = montar({
      execucoes: [execucao({ group_id: "g1" })],
      grupos: [{ group_id: "g1", scheduled_whatsapp_groups: { name: "VIP", external_group_id: "1@g.us", is_active: true } }],
      medias: [{ id: "m1", kind: "image", storage_path: `${ORG}/publications/pub1/a.jpg`, mime: "image/jpeg", filename: "a.jpg", size_bytes: 10, cover_storage_path: null, position: 1 }],
    });
    const r = await executarExecucoesArrendadas(admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA });
    expect(r).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    const updates = cadeias(chamadas, "publication_executions", "update").map((c) => argDe(c.ops, "update") as Record<string, unknown>);
    expect(updates[0]).toMatchObject({ status: "sending" });
    expect(updates.at(-1)).toMatchObject({ status: "sent", external_post_id: "ext-1", metadata: { external_ids: ["ext-1"], sent_files: 1 } });
    // A finalização é guardada por status E worker.
    const fim = cadeias(chamadas, "publication_executions", "update").at(-1)!;
    expect(fim.ops.some((o) => o.m === "eq" && o.args[0] === "status" && o.args[1] === "sending")).toBe(true);
    expect(fim.ops.some((o) => o.m === "eq" && o.args[0] === "worker_id" && o.args[1] === WORKER)).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("fn_rollup_publication_occurrence", { p_occurrence: "occ1" });
    // O pedido ao canal fala em rede, formato, grupo e mídia assinada — nunca em provedor.
    const pedido = publish.mock.calls[0]![0] as Record<string, unknown>;
    expect(pedido).toMatchObject({ network: "whatsapp", format: "group_message", to: "1@g.us", idempotencyKey: "k1", referencia: "e1", caption: "Coca 2L" });
    expect((pedido.media as Array<{ url: string }>)[0]!.url).toContain("token=");
  });

  it("aceito pelo provedor (vídeo processando): fica em sending com id externo, sem falha", async () => {
    publish.mockReset().mockResolvedValue({ estado: "accepted", externalId: "post-9", providerStatus: "processing" });
    const { admin, chamadas } = montar({ execucoes: [execucao()], sessao: { platform: "instagram" }, target: { network: "instagram", format: "reel" } });
    const r = await executarExecucoesArrendadas(admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA });
    expect(r).toMatchObject({ accepted: 1, failed: 0, sent: 0 });
    expect(argDe(cadeias(chamadas, "publication_executions", "update").at(-1)!.ops, "update")).toMatchObject({ status: "sending", external_post_id: "post-9", provider_status: "processing" });
  });

  it("falha TRANSITÓRIA: failed com retry_at e sem aviso na Central; PERMANENTE: sem retry e com aviso", async () => {
    publish.mockReset().mockResolvedValue({ estado: "failed", codigo: "rate_limited", categoria: "transitorio", mensagem: "429", retryAfterMs: 120_000 });
    const t = montar({ execucoes: [execucao()], sessao: { platform: "instagram" }, target: { network: "instagram", format: "feed" } });
    await executarExecucoesArrendadas(t.admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA });
    const fim = argDe(cadeias(t.chamadas, "publication_executions", "update").at(-1)!.ops, "update") as Record<string, unknown>;
    expect(fim).toMatchObject({ status: "failed", error_code: "rate_limited", error_category: "transitorio" });
    expect(new Date(fim.retry_at as string).getTime()).toBeGreaterThanOrEqual(AGORA.getTime() + 120_000);
    expect(cadeias(t.chamadas, "agent_inbox_items", "insert")).toHaveLength(0);

    publish.mockReset().mockResolvedValue({ estado: "failed", codigo: "account_disconnected", categoria: "permanente", mensagem: "desconectada" });
    const p = montar({ execucoes: [execucao()], sessao: { platform: "instagram" }, target: { network: "instagram", format: "feed" } });
    await executarExecucoesArrendadas(p.admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA });
    const fimP = argDe(cadeias(p.chamadas, "publication_executions", "update").at(-1)!.ops, "update") as Record<string, unknown>;
    expect(fimP).toMatchObject({ status: "failed", error_category: "permanente", retry_at: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(cadeias(p.chamadas, "agent_inbox_items", "insert")).toHaveLength(1);
  });

  it("envio parcial no WhatsApp é permanente: registra quantos arquivos saíram e NÃO agenda retry", async () => {
    publish.mockReset().mockResolvedValue({ estado: "failed", codigo: "partial_send", categoria: "permanente", mensagem: "2 de 3", sentFiles: 2, externalId: "ext-1" });
    const { admin, chamadas } = montar({
      execucoes: [execucao({ group_id: "g1" })],
      grupos: [{ group_id: "g1", scheduled_whatsapp_groups: { name: "VIP", external_group_id: "1@g.us", is_active: true } }],
    });
    await executarExecucoesArrendadas(admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA });
    const fim = argDe(cadeias(chamadas, "publication_executions", "update").at(-1)!.ops, "update") as Record<string, unknown>;
    expect(fim).toMatchObject({ status: "failed", error_code: "partial_send", retry_at: null, metadata: { sent_files: 2 } });
  });

  it("conexão STARTING é transitória; STOPPED é permanente; nenhuma chama o canal", async () => {
    publish.mockReset();
    const s = montar({ execucoes: [execucao()], sessao: { status: "STARTING", platform: "instagram" }, target: { network: "instagram", format: "feed" } });
    await executarExecucoesArrendadas(s.admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA });
    expect(argDe(cadeias(s.chamadas, "publication_executions", "update").at(-1)!.ops, "update")).toMatchObject({ error_code: "channel_starting", error_category: "transitorio" });
    const p = montar({ execucoes: [execucao()], sessao: { status: "STOPPED" }, target: { network: "whatsapp" } });
    await executarExecucoesArrendadas(p.admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA });
    expect(argDe(cadeias(p.chamadas, "publication_executions", "update").at(-1)!.ops, "update")).toMatchObject({ error_code: "channel_not_working", error_category: "permanente" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("Stories saem em ORDEM de posição e cada um leva só o SEU arquivo; entre posts da mesma conta há pausa", async () => {
    const ordem: string[] = [];
    publish.mockReset().mockImplementation(async (pedido: { media: Array<{ url: string }> }) => {
      ordem.push(pedido.media[0]!.url);
      return { estado: "sent", externalId: `ext-${ordem.length}`, url: null };
    });
    const medias = [1, 2, 3].map((i) => ({ id: `m${i}`, kind: "image", storage_path: `${ORG}/publications/pub1/${i}.jpg`, mime: "image/jpeg", filename: `${i}.jpg`, size_bytes: 1, cover_storage_path: null, position: i }));
    const { admin } = montar({
      execucoes: [execucao({ id: "e3", media_id: "m3", position: 3 }), execucao({ id: "e1", media_id: "m1", position: 1 }), execucao({ id: "e2", media_id: "m2", position: 2 })],
      sessao: { platform: "instagram" },
      target: { network: "instagram", format: "story" },
      medias,
    });
    esperar.mockClear();
    const r = await executarExecucoesArrendadas(admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA });
    expect(r.sent).toBe(3);
    expect(ordem.map((u) => u.match(/\/(\d)\.jpg/)![1])).toEqual(["1", "2", "3"]);
    expect(esperar).toHaveBeenCalledTimes(2);
  });

  it("orçamento estourado: devolve o lease e não chama o canal", async () => {
    publish.mockReset();
    const { admin, chamadas } = montar({ execucoes: [execucao()], sessao: { platform: "instagram" }, target: { network: "instagram", format: "feed" } });
    const r = await executarExecucoesArrendadas(admin as never, AGORA, "req", { workerId: WORKER, esperar, relogio: () => AGORA, prazoMs: Date.now() - 1 });
    expect(r).toMatchObject({ claimed: 1, sent: 0, failed: 0 });
    expect(publish).not.toHaveBeenCalled();
    expect(argDe(cadeias(chamadas, "publication_executions", "update")[0]!.ops, "update")).toEqual({ lease_until: null, worker_id: null });
  });
});
