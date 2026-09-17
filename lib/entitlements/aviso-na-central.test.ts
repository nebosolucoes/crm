import { describe, expect, it, vi } from "vitest";

import {
  avisarBloqueioPorRecurso,
  avisarBloqueioPorRecursoPg,
  tituloDoAvisoDeBloqueio,
} from "./aviso-na-central";

const ORG = "22222222-2222-4222-8222-222222222222";

describe("aviso na Central por bloqueio de plano", () => {
  it("pg: um único INSERT … WHERE NOT EXISTS, com kind, título e ref da organização", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "i1" }] }));
    expect(await avisarBloqueioPorRecursoPg({ query } as never, ORG, "broadcast", "Um disparo")).toBe(true);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/insert into agent_inbox_items/);
    expect(sql).toMatch(/where not exists/);
    expect(sql).toMatch(/date_trunc\('month', now\(\)\)/);
    expect(params).toEqual([
      ORG,
      "entitlement_changed",
      tituloDoAvisoDeBloqueio("broadcast"),
      expect.stringContaining("Um disparo"),
    ]);
  });

  it("pg: quando já existe no mês, o insert não devolve linha → false", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await avisarBloqueioPorRecursoPg({ query } as never, ORG, "ai_agents", "x")).toBe(false);
  });

  it("supabase: lê o mês e só insere quando não há; existente → false sem lançar", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const contador = { n: 0 };
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ eq: () => ({ gte: async () => ({ count: contador.n, error: null }) }) }),
          }),
        }),
        insert,
      }),
    } as never;
    expect(await avisarBloqueioPorRecurso(admin, ORG, "crm", "x")).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: ORG, kind: "entitlement_changed", ref_kind: "organization", ref_id: ORG }),
    );
    contador.n = 1;
    expect(await avisarBloqueioPorRecurso(admin, ORG, "crm", "x")).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
