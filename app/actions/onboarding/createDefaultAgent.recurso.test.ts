import { describe, expect, it, vi } from "vitest";

// A organização existe e a pessoa é o dono; o que falta é o RECURSO no plano.
vi.mock("./_shared", async (original) => {
  const real = await original<typeof import("./_shared")>();
  return {
    ...real,
    requireOnboardingCtx: async () => ({
      userId: "11111111-1111-4111-8111-111111111111",
      orgId: "22222222-2222-4222-8222-222222222222",
      orgName: "Org",
      role: "admin",
      fullName: null,
      email: "a@example.com",
    }),
  };
});
const orgTemRecurso = vi.fn(async () => false);
vi.mock("@/lib/entitlements/resolver", () => ({ orgTemRecurso: () => orgTemRecurso() }));
// Nada abaixo do gate pode ser tocado: o admin client nem chega a ser criado.
const createAdminClient = vi.fn(() => { throw new Error("não devia chegar ao banco"); });
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));

const { createDefaultAgent } = await import("./createDefaultAgent");

describe("createDefaultAgent × plano (migration 0275)", () => {
  it("sem Agentes de IA no plano, recusa com feature_not_entitled ANTES de tocar o banco", async () => {
    const fd = new FormData();
    fd.set("name", "Atendente");
    const r = await createDefaultAgent(fd);
    expect(r).toEqual({ ok: false, error: "feature_not_entitled" });
    expect(orgTemRecurso).toHaveBeenCalledTimes(1);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
