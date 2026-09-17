import { describe, expect, it } from "vitest";

import {
  lerEntitlements,
  overridesDoRecurso,
  serializarEntitlements,
  temRecurso,
} from "./tipos";

const PLANO = { id: "p1", slug: "starter", name: "Starter", is_active: true };

describe("lerEntitlements (a forma do jsonb de fn_org_entitlements)", () => {
  it("lê um jsonb completo", () => {
    const e = lerEntitlements({
      plan: PLANO,
      origem: "atribuido",
      features: ["inbox", "crm"],
      limits: { max_users: 5 },
      overrides: [
        { id: "o1", feature: "ai_agents", mode: "enable", starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-10-01T00:00:00Z", limits: { max_ai_agents: 2 }, reason: "teste de 30 dias" },
      ],
    });
    expect(e.plan).toEqual(PLANO);
    expect(e.origem).toBe("atribuido");
    expect([...e.features].sort()).toEqual(["channels", "crm", "inbox"]);
    expect(e.limits).toEqual({ max_users: 5 });
    expect(e.overrides).toHaveLength(1);
    expect(e.overrides[0]!.limits).toEqual({ max_ai_agents: 2 });
  });

  it("channels entra SEMPRE — jsonb vazio, torto ou sem features", () => {
    expect(temRecurso(lerEntitlements({}), "channels")).toBe(true);
    expect(temRecurso(lerEntitlements(null), "channels")).toBe(true);
    expect(temRecurso(lerEntitlements("lixo"), "channels")).toBe(true);
    expect(temRecurso(lerEntitlements({ features: ["crm"] }), "channels")).toBe(true);
  });

  it("jsonb sem forma vira o entitlement MÍNIMO e observável (origem nenhum, só channels)", () => {
    const e = lerEntitlements(undefined);
    expect(e.origem).toBe("nenhum");
    expect(e.plan).toBeNull();
    expect([...e.features]).toEqual(["channels"]);
    expect(e.overrides).toEqual([]);
    expect(e.limits).toEqual({});
  });

  it("feature desconhecida é descartada (banco mais novo que o app não derruba o layout)", () => {
    const e = lerEntitlements({ features: ["crm", "agenda_v2", 7, null] });
    expect([...e.features].sort()).toEqual(["channels", "crm"]);
  });

  it("override torto é descartado; override que desliga channels é recusado mesmo que o jsonb afirme", () => {
    const e = lerEntitlements({
      overrides: [
        { id: "ok", feature: "crm", mode: "disable", starts_at: "2026-09-01T00:00:00Z" },
        { id: "sem-modo", feature: "crm", mode: "talvez", starts_at: "2026-09-01T00:00:00Z" },
        { id: "sem-inicio", feature: "crm", mode: "enable" },
        { id: "canais", feature: "channels", mode: "disable", starts_at: "2026-09-01T00:00:00Z" },
        "string",
      ],
    });
    expect(e.overrides.map((o) => o.id)).toEqual(["ok"]);
    expect(e.overrides[0]).toMatchObject({ ends_at: null, limits: {}, reason: "" });
  });

  it("plano sem id/slug/name vira null; is_active ausente é true", () => {
    expect(lerEntitlements({ plan: { id: "x" } }).plan).toBeNull();
    expect(lerEntitlements({ plan: { id: "x", slug: "s", name: "n" } }).plan?.is_active).toBe(true);
    expect(lerEntitlements({ plan: { id: "x", slug: "s", name: "n", is_active: false } }).plan?.is_active).toBe(false);
  });

  it("origem ausente: com plano é atribuido, sem plano é nenhum — nunca inventa padrao", () => {
    expect(lerEntitlements({ plan: PLANO }).origem).toBe("atribuido");
    expect(lerEntitlements({ features: ["crm"] }).origem).toBe("nenhum");
    expect(lerEntitlements({ plan: PLANO, origem: "padrao" }).origem).toBe("padrao");
  });
});

describe("temRecurso", () => {
  const e = lerEntitlements({ features: ["inbox", "crm"] });

  it("responde pela forma do servidor e pela serializada", () => {
    expect(temRecurso(e, "crm")).toBe(true);
    expect(temRecurso(e, "broadcast")).toBe(false);
    const s = serializarEntitlements(e);
    expect(Array.isArray(s.features)).toBe(true);
    expect(temRecurso(s, "crm")).toBe(true);
    expect(temRecurso(s, "ai_agents")).toBe(false);
  });

  it("não carregado: fechado para o vendável, aberto para a lei", () => {
    expect(temRecurso(null, "crm")).toBe(false);
    expect(temRecurso(undefined, "inbox")).toBe(false);
    expect(temRecurso(null, "channels")).toBe(true);
  });
});

describe("overridesDoRecurso", () => {
  it("filtra pelo recurso", () => {
    const e = lerEntitlements({
      overrides: [
        { id: "a", feature: "ai_agents", mode: "enable", starts_at: "2026-09-01T00:00:00Z" },
        { id: "b", feature: "crm", mode: "disable", starts_at: "2026-09-01T00:00:00Z" },
      ],
    });
    expect(overridesDoRecurso(e, "ai_agents").map((o) => o.id)).toEqual(["a"]);
    expect(overridesDoRecurso(serializarEntitlements(e), "crm").map((o) => o.id)).toEqual(["b"]);
    expect(overridesDoRecurso(e, "inbox")).toEqual([]);
  });
});
