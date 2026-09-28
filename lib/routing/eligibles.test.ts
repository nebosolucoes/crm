import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEligibleAttendants } from "./eligibles";

function fixture(over: Record<string, unknown> = {}) {
  const filters: Array<[string, string, unknown]> = [];
  const rows: Record<string, unknown> = {
    channel_sessions: { id: "channel" }, channel_routing_policies: null,
    channel_routing_responsibles: [], user_organizations: [{ user_id: "ana" }],
    attendant_availability: [{ user_id: "ana", capacity: 2, schedule: {} }],
    conversations: [], conversation_assignment_events: [], ...over,
  };
  const db = { from(table: string) {
    const q = {
      select() { return q; }, order() { return q; },
      eq(key: string, value: unknown) { filters.push([table, key, value]); return q; },
      is(key: string, value: unknown) { filters.push([table, key, value]); return q; },
      in(key: string, value: unknown) { filters.push([table, key, value]); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[table], error: null }); },
      then(resolve: (x: unknown) => unknown) {
        return Promise.resolve(rows[table] instanceof Error
          ? { data: null, error: rows[table] }
          : { data: rows[table], error: null }).then(resolve);
      },
    }; return q;
  } } as unknown as SupabaseClient;
  return { db, filters };
}
const scope = { kind: "conversation_channel", channelSessionId: "channel" } as const;
const now = new Date("2026-09-06T15:00:00Z");
describe("elegibilidade com origem explícita", () => {
  it("política vazia não cai no conjunto legado", async () => {
    const { db } = fixture({ channel_routing_policies: { id: "policy" } });
    expect(await loadEligibleAttendants(db, "org", now, scope)).toEqual([]);
  });
  it("membro revogado não recebe mesmo com disponibilidade legada", async () => {
    const { db } = fixture({ user_organizations: [] });
    expect(await loadEligibleAttendants(db, "org", now, scope)).toEqual([]);
  });
  it("capacidade é global e histórico é apenas do canal, com org nas duas tabelas", async () => {
    const { db, filters } = fixture();
    expect(await loadEligibleAttendants(db, "org", now, scope)).toMatchObject([{ userId: "ana" }]);
    expect(filters).toContainEqual(["conversation_assignment_events", "conversations.channel_session_id", "channel"]);
    expect(filters).toContainEqual(["conversation_assignment_events", "conversations.organization_id", "org"]);
    expect(filters).not.toContainEqual(["conversations", "channel_session_id", "channel"]);
  });
  it("resumo global não consulta política", async () => {
    const { db, filters } = fixture();
    await loadEligibleAttendants(db, "org", now, { kind: "organization_summary" });
    expect(filters.some(([table]) => table === "channel_routing_policies")).toBe(false);
  });
  it("canal inexistente não autoriza fallback", async () => {
    const { db } = fixture({ channel_sessions: null });
    await expect(loadEligibleAttendants(db, "org", now, scope)).rejects.toThrow("routing_channel_invalid");
  });
  it("erro de banco não vira sem elegível", async () => {
    const { db } = fixture({ attendant_availability: new Error("offline") });
    await expect(loadEligibleAttendants(db, "org", now, scope)).rejects.toThrow("offline");
  });
});

describe("elegibilidade por setor (spec 20 §3.1)", () => {
  const comSetor = { ...scope, sectorId: "fin" } as const;
  const base = {
    sectors: { id: "fin" },
    user_organizations: [{ user_id: "ana" }, { user_id: "bruno" }],
    attendant_availability: [
      { user_id: "ana", capacity: 2, schedule: {} },
      { user_id: "bruno", capacity: 2, schedule: {} },
    ],
  };
  it("só membro do setor recebe", async () => {
    const { db } = fixture({ ...base, sector_members: [{ user_id: "ana" }] });
    expect(await loadEligibleAttendants(db, "org", now, comSetor)).toMatchObject([{ userId: "ana" }]);
  });
  it("setor ativo sem membro = ninguém (restrição explícita)", async () => {
    const { db } = fixture({ ...base, sector_members: [] });
    expect(await loadEligibleAttendants(db, "org", now, comSetor)).toEqual([]);
  });
  it("setor inativo é ignorado: vale o conjunto sem setor", async () => {
    const { db, filters } = fixture({ ...base, sectors: null, sector_members: [{ user_id: "ana" }] });
    const r = await loadEligibleAttendants(db, "org", now, comSetor);
    expect(r.map((c) => c.userId).sort()).toEqual(["ana", "bruno"]);
    expect(filters.some(([table]) => table === "sector_members")).toBe(false);
  });
  it("setor E política por número: interseção", async () => {
    const { db } = fixture({
      ...base,
      channel_routing_policies: { id: "policy" },
      channel_routing_responsibles: [{ user_id: "bruno" }],
      sector_members: [{ user_id: "ana" }, { user_id: "bruno" }],
    });
    expect(await loadEligibleAttendants(db, "org", now, comSetor)).toMatchObject([{ userId: "bruno" }]);
  });
  it("sem setor na conversa nada muda, e o setor é lido filtrando organization_id", async () => {
    const { db, filters } = fixture({ ...base, sector_members: [{ user_id: "ana" }] });
    await loadEligibleAttendants(db, "org", now, comSetor);
    expect(filters).toContainEqual(["sectors", "organization_id", "org"]);
    expect(filters).toContainEqual(["sector_members", "organization_id", "org"]);
    const { db: semSetor, filters: f2 } = fixture(base);
    await loadEligibleAttendants(semSetor, "org", now, { ...scope, sectorId: null });
    expect(f2.some(([table]) => table === "sectors")).toBe(false);
  });
});
