import { beforeEach, describe, expect, it, vi } from "vitest";

const orgTemRecurso = vi.fn(async (_org: string, _recurso: string) => true);
vi.mock("./resolver", () => ({ orgTemRecurso: (o: string, r: string) => orgTemRecurso(o, r) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const limiteAtingido = vi.fn(async (..._a: unknown[]): Promise<{ teto: number; uso: number } | null> => null);
vi.mock("./consumo", () => ({ limiteAtingido: (...a: unknown[]) => limiteAtingido(...a) }));

const { recusaPorRecurso, recusaPorLimite } = await import("./exigir-na-rota");
const { audit } = await import("@/lib/audit");

const ORG = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  orgTemRecurso.mockReset();
  orgTemRecurso.mockResolvedValue(true);
  vi.mocked(audit).mockClear();
});

describe("recusaPorRecurso", () => {
  it("null quando a organização tem o recurso — e nada é auditado", async () => {
    expect(await recusaPorRecurso(ORG, "crm", { requestId: "r" })).toBeNull();
    expect(orgTemRecurso).toHaveBeenCalledWith(ORG, "crm");
    expect(audit).not.toHaveBeenCalled();
  });

  it("403 feature_not_entitled com details.feature, e authz.denied com reason — por sessão ou por token", async () => {
    orgTemRecurso.mockResolvedValue(false);
    const r = await recusaPorRecurso(ORG, "broadcast", { requestId: "r-1", resource: "x", actorApiTokenId: "tok-1" });
    expect(r?.status).toBe(403);
    const body = await r!.json();
    expect(body.error.code).toBe("feature_not_entitled");
    expect(body.error.details).toEqual({ feature: "broadcast" });
    expect(body.error.message).toMatch(/Disparo/);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "authz.denied",
        organizationId: ORG,
        actorUserId: null,
        actorApiTokenId: "tok-1",
        resourceType: "x",
        requestId: "r-1",
        metadata: { reason: "feature_not_entitled", feature: "broadcast" },
      }),
    );
  });

  it("erro do resolvedor sobe — nunca vira 403", async () => {
    orgTemRecurso.mockImplementation(() => {
      throw new Error("entitlements_unavailable: boom");
    });
    await expect(recusaPorRecurso(ORG, "crm", {})).rejects.toThrow(/entitlements_unavailable/);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("recusaPorLimite (etapa 8)", () => {
  const admin = {} as never;

  it("abaixo do teto: null, nada auditado", async () => {
    limiteAtingido.mockResolvedValue(null);
    expect(await recusaPorLimite(ORG, "max_channels", { admin, requestId: "r" })).toBeNull();
    expect(limiteAtingido).toHaveBeenCalledWith(admin, ORG, "max_channels");
    expect(audit).not.toHaveBeenCalled();
  });

  it("no teto: 409 limit_reached com details { limite, teto, uso } e authz.denied reason=limit_reached", async () => {
    limiteAtingido.mockResolvedValue({ teto: 3, uso: 3 });
    const r = await recusaPorLimite(ORG, "max_ai_agents", { admin, requestId: "r-9", resource: "ai_agents", actorUserId: "u1" });
    expect(r?.status).toBe(409);
    const body = await r!.json();
    expect(body.error.code).toBe("limit_reached");
    expect(body.error.details).toEqual({ limite: "max_ai_agents", teto: 3, uso: 3 });
    expect(body.error.message).toMatch(/Agentes de IA/);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "authz.denied",
        organizationId: ORG,
        actorUserId: "u1",
        resourceType: "ai_agents",
        requestId: "r-9",
        metadata: { reason: "limit_reached", limite: "max_ai_agents", teto: 3, uso: 3 },
      }),
    );
  });
});
