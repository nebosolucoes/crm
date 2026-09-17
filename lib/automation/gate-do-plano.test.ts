import { beforeEach, describe, expect, it, vi } from "vitest";

const orgTemRecurso = vi.fn(async (_o: string, _r: string) => true);
vi.mock("@/lib/entitlements/resolver", () => ({ orgTemRecurso: (o: string, r: string) => orgTemRecurso(o, r) }));
const avisar = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/entitlements/aviso-na-central", () => ({
  avisarBloqueioPorRecurso: (...a: unknown[]) => avisar(...a),
}));

const { resultadoSeForaDoPlano } = await import("./gate-do-plano");
const ORG = "22222222-2222-4222-8222-222222222222";
const admin = {} as never;

beforeEach(() => {
  orgTemRecurso.mockReset();
  orgTemRecurso.mockResolvedValue(true);
  avisar.mockClear();
});

describe("gate de plano por ação de automação", () => {
  it("ação do produto (call_webhook) nem consulta o plano", async () => {
    expect(await resultadoSeForaDoPlano(admin, ORG, "call_webhook", "R")).toBeNull();
    expect(orgTemRecurso).not.toHaveBeenCalled();
  });

  it("com o recurso, a ação roda", async () => {
    expect(await resultadoSeForaDoPlano(admin, ORG, "send_ai_message", "R")).toBeNull();
    expect(orgTemRecurso).toHaveBeenCalledWith(ORG, "ai_agents");
  });

  it("sem o recurso: skipped com feature_not_entitled, e a Central é avisada — a regra segue com as irmãs", async () => {
    orgTemRecurso.mockResolvedValue(false);
    const r = await resultadoSeForaDoPlano(admin, ORG, "create_or_move_lead", "Regra X");
    expect(r).toEqual({
      type: "create_or_move_lead",
      status: "skipped",
      error: "feature_not_entitled",
      detail: { feature: "crm" },
    });
    expect(avisar).toHaveBeenCalledWith(admin, ORG, "crm", expect.stringContaining("Regra X"));
  });

  it("falha da consulta NUNCA barra a ação", async () => {
    orgTemRecurso.mockRejectedValue(new Error("boom"));
    expect(await resultadoSeForaDoPlano(admin, ORG, "send_ai_message", "R")).toBeNull();
    expect(avisar).not.toHaveBeenCalled();
  });
});
