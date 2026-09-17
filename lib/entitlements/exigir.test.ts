import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
const loadAuthUser = vi.fn();
const resolveActiveOrg = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: () => loadAuthUser(),
  resolveActiveOrg: (u: unknown) => resolveActiveOrg(u),
}));
const orgTemRecurso = vi.fn(async (_o: string, _r: string) => true);
vi.mock("./resolver", () => ({ orgTemRecurso: (o: string, r: string) => orgTemRecurso(o, r) }));

const { exigirRecurso, ROTA_DE_RECURSO_INDISPONIVEL } = await import("./exigir");

const ORG = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  redirect.mockClear();
  orgTemRecurso.mockReset();
  orgTemRecurso.mockResolvedValue(true);
  loadAuthUser.mockReset();
  loadAuthUser.mockResolvedValue({ id: "u" });
  resolveActiveOrg.mockReset();
  resolveActiveOrg.mockResolvedValue({ orgId: ORG, role: "admin" });
});

describe("exigirRecurso (gate de página)", () => {
  it("channels devolve sem tocar sessão nem plano", async () => {
    await exigirRecurso("channels");
    expect(loadAuthUser).not.toHaveBeenCalled();
    expect(orgTemRecurso).not.toHaveBeenCalled();
  });

  it("com o recurso, devolve sem redirecionar", async () => {
    await exigirRecurso("crm");
    expect(orgTemRecurso).toHaveBeenCalledWith(ORG, "crm");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sem o recurso, redireciona para a tela de recurso indisponível com o recurso na URL", async () => {
    orgTemRecurso.mockResolvedValue(false);
    await expect(exigirRecurso("broadcast")).rejects.toThrow("REDIRECT:");
    expect(redirect).toHaveBeenCalledWith(`${ROTA_DE_RECURSO_INDISPONIVEL}?recurso=broadcast`);
  });

  it("sem sessão vai para o login; sem organização ativa devolve (o layout já cuida)", async () => {
    loadAuthUser.mockResolvedValue(null);
    await expect(exigirRecurso("crm")).rejects.toThrow("REDIRECT:/login");
    loadAuthUser.mockResolvedValue({ id: "u" });
    resolveActiveOrg.mockResolvedValue(null);
    await exigirRecurso("crm");
    expect(orgTemRecurso).not.toHaveBeenCalled();
  });
});
