import { describe, expect, it, vi } from "vitest";

import { argDe, cadeias, fakeAdmin, nomes, type Op } from "./_fake-admin";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { expandirOcorrenciasVencidas } = await import("./expandir");

const ORG = "22222222-2222-4222-8222-222222222222";
const AGORA = new Date("2026-09-30T22:31:00.000Z");

interface Cenario {
  ocorrencia?: Record<string, unknown> | null;
  publicacao?: Record<string, unknown> | null;
  targets?: Array<Record<string, unknown>>;
  medias?: Array<Record<string, unknown>>;
  grupos?: Array<Record<string, unknown>>;
  retries?: Array<Record<string, unknown>>;
}

function responder(c: Cenario) {
  return (tabela: string, ops: Op[]): unknown => {
    const n = nomes(ops);
    if (tabela === "publication_occurrences" && n[0] === "select") return { data: c.ocorrencia ? [c.ocorrencia] : [], error: null };
    if (tabela === "publication_occurrences" && n[0] === "update") return { data: [{ id: "occ1" }], error: null };
    if (tabela === "publications") return { data: c.publicacao === undefined ? { id: "pub1", title: "Oferta", body: "x", deleted_at: null, status: "scheduled" } : c.publicacao, error: null };
    if (tabela === "publication_targets") return { data: c.targets ?? [], error: null };
    if (tabela === "publication_media") return { data: c.medias ?? [], error: null };
    if (tabela === "publication_target_groups") return { data: c.grupos ?? [], error: null };
    if (tabela === "publication_executions" && n[0] === "select") return { data: c.retries ?? [], error: null };
    if (tabela === "publication_executions") return { data: null, error: null };
    if (tabela === "agent_inbox_items" && n[0] === "select") return { count: 0, error: null };
    return { data: null, error: null, count: 0 };
  };
}

const OCC = { id: "occ1", organization_id: ORG, publication_id: "pub1", scheduled_at: "2026-09-30T22:30:00.000Z" };

describe("expandir — ocorrência vencida vira execuções", () => {
  it("WhatsApp: uma execução por GRUPO; Stories: uma por ARQUIVO; Feed: uma só — todas pendentes", async () => {
    const { admin, chamadas } = fakeAdmin(
      responder({
        ocorrencia: OCC,
        targets: [
          { id: "t-wa", network: "whatsapp", format: "group_message", channel_session_id: "s1", metadata: {} },
          { id: "t-st", network: "instagram", format: "story", channel_session_id: "s2", metadata: {} },
          { id: "t-fd", network: "facebook", format: "feed", channel_session_id: "s3", metadata: {} },
        ],
        medias: [{ id: "m1", position: 1 }, { id: "m2", position: 2 }, { id: "m3", position: 3 }],
        grupos: [{ target_id: "t-wa", group_id: "g1" }, { target_id: "t-wa", group_id: "g2" }],
      }),
      (fn) => (fn === "fn_org_has_feature" ? { data: true, error: null } : { data: null, error: null }),
    );
    const r = await expandirOcorrenciasVencidas(admin as never, AGORA, "req");
    expect(r).toMatchObject({ expanded: 1, executions: 6, skipped: 0 });
    const insert = cadeias(chamadas, "publication_executions", "insert")[0]!;
    const linhas = argDe(insert.ops, "insert") as Array<Record<string, unknown>>;
    expect(linhas.filter((l) => l.target_id === "t-wa").map((l) => l.group_id)).toEqual(["g1", "g2"]);
    expect(linhas.filter((l) => l.target_id === "t-st").map((l) => l.media_id)).toEqual(["m1", "m2", "m3"]);
    expect(linhas.filter((l) => l.target_id === "t-fd")).toHaveLength(1);
    expect(linhas.every((l) => l.status === "pending" && l.attempt === 1)).toBe(true);
    // A ocorrência foi para `processing` com guarda no status pendente.
    const claim = cadeias(chamadas, "publication_occurrences", "update")[0]!;
    expect(argDe(claim.ops, "update")).toMatchObject({ status: "processing" });
    expect(claim.ops.some((o) => o.m === "eq" && o.args[0] === "status" && o.args[1] === "pending")).toBe(true);
  });

  it("janela perdida (> 30 min): pula com missed_window, avisa e NÃO cria execução", async () => {
    const tarde = new Date("2026-09-30T23:05:00.000Z");
    const { admin, chamadas } = fakeAdmin(
      responder({ ocorrencia: OCC, targets: [{ id: "t", network: "facebook", format: "feed", channel_session_id: "s", metadata: {} }] }),
      () => ({ data: true, error: null }),
    );
    const r = await expandirOcorrenciasVencidas(admin as never, tarde, "req");
    expect(r).toMatchObject({ expanded: 0, skipped: 1 });
    const skip = cadeias(chamadas, "publication_occurrences", "update").find((c) => (argDe(c.ops, "update") as { status?: string }).status === "skipped")!;
    expect(argDe(skip.ops, "update")).toMatchObject({ skipped_reason: "missed_window" });
    expect(cadeias(chamadas, "publication_executions", "insert")).toHaveLength(0);
    expect(cadeias(chamadas, "agent_inbox_items", "insert")).toHaveLength(1);
  });

  it("sem o recurso no plano: pula com feature_not_entitled e não toca no provedor", async () => {
    const { admin, chamadas } = fakeAdmin(
      responder({ ocorrencia: OCC, targets: [{ id: "t", network: "facebook", format: "feed", channel_session_id: "s", metadata: {} }] }),
      (fn) => (fn === "fn_org_has_feature" ? { data: false, error: null } : { data: null, error: null }),
    );
    const r = await expandirOcorrenciasVencidas(admin as never, AGORA, "req");
    expect(r.skipped).toBe(1);
    const skip = cadeias(chamadas, "publication_occurrences", "update").find((c) => (argDe(c.ops, "update") as { status?: string }).status === "skipped")!;
    expect(argDe(skip.ops, "update")).toMatchObject({ skipped_reason: "feature_not_entitled" });
    expect(cadeias(chamadas, "publication_executions", "insert")).toHaveLength(0);
  });

  it("erro ao conferir o plano NÃO segura a publicação (segue como se tivesse)", async () => {
    const { admin } = fakeAdmin(
      responder({ ocorrencia: OCC, targets: [{ id: "t", network: "facebook", format: "feed", channel_session_id: "s", metadata: {} }] }),
      (fn) => (fn === "fn_org_has_feature" ? { data: null, error: { message: "boom" } } : { data: null, error: null }),
    );
    const r = await expandirOcorrenciasVencidas(admin as never, AGORA, "req");
    expect(r).toMatchObject({ expanded: 1, executions: 1 });
  });

  it("destino removido na edição não gera execução; publicação excluída pula", async () => {
    const { admin, chamadas } = fakeAdmin(
      responder({ ocorrencia: OCC, targets: [{ id: "t", network: "facebook", format: "feed", channel_session_id: "s", metadata: { removed_at: "2026-09-30T00:00:00Z" } }] }),
      () => ({ data: true, error: null }),
    );
    const r = await expandirOcorrenciasVencidas(admin as never, AGORA, "req");
    expect(r.skipped).toBe(1);
    expect(argDe(cadeias(chamadas, "publication_occurrences", "update").at(-1)!.ops, "update")).toMatchObject({ skipped_reason: "no_targets" });

    const { admin: admin2 } = fakeAdmin(responder({ ocorrencia: OCC, publicacao: { id: "pub1", deleted_at: "2026-09-30T00:00:00Z", status: "scheduled" } }), () => ({ data: true, error: null }));
    const r2 = await expandirOcorrenciasVencidas(admin2 as never, AGORA, "req");
    expect(r2.skipped).toBe(1);
  });

  it("falha transitória com retry_at vencido ganha a tentativa seguinte (attempt+1) e o retry_at é zerado", async () => {
    const { admin, chamadas } = fakeAdmin(
      responder({ ocorrencia: null, retries: [{ id: "e1", organization_id: ORG, publication_id: "pub1", occurrence_id: "occ1", target_id: "t", group_id: null, media_id: null, position: 0, attempt: 1 }] }),
    );
    const r = await expandirOcorrenciasVencidas(admin as never, AGORA, "req");
    expect(r.retries).toBe(1);
    const insert = cadeias(chamadas, "publication_executions", "insert")[0]!;
    expect(argDe(insert.ops, "insert")).toMatchObject({ attempt: 2, status: "pending", metadata: { retry_of: "e1" } });
    const zera = cadeias(chamadas, "publication_executions", "update")[0]!;
    expect(argDe(zera.ops, "update")).toEqual({ retry_at: null });
  });
});
