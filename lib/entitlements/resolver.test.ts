import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ rpc })) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { entitlementsDaOrg, orgTemRecurso } = await import("./resolver");
const { logger } = await import("@/lib/logger");

const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(logger.error).mockReset();
});

describe("entitlementsDaOrg", () => {
  it("chama fn_org_entitlements com a org e dá forma ao jsonb", async () => {
    rpc.mockResolvedValue({
      data: { plan: { id: "p", slug: "starter", name: "Starter", is_active: true }, origem: "atribuido", features: ["inbox"], limits: {}, overrides: [] },
      error: null,
    });
    const e = await entitlementsDaOrg(ORG);
    expect(rpc).toHaveBeenCalledWith("fn_org_entitlements", { p_org: ORG });
    expect(e.plan?.slug).toBe("starter");
    expect([...e.features].sort()).toEqual(["channels", "inbox"]);
  });

  it("erro da RPC LANÇA e loga — nunca vira 'sem recurso'", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57P01", message: "terminating connection" } });
    await expect(entitlementsDaOrg(ORG)).rejects.toThrow(/entitlements_unavailable/);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg, meta] = vi.mocked(logger.error).mock.calls[0]!;
    expect(String(msg)).toMatch(/NÃO tratado como sem recurso/);
    expect(meta).toMatchObject({ organization_id: ORG, code: "57P01" });
  });
});

describe("a única degradação: a função não existe no banco", () => {
  it.each(["PGRST202", "42883"])("%s → responde como o legado (tudo ligado), origem sem_schema, e loga erro", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "Could not find the function" } });
    const e = await entitlementsDaOrg(ORG);
    expect(e.origem).toBe("sem_schema");
    expect(e.plan).toBeNull();
    expect([...e.features].sort()).toEqual(["ai_agents", "analytics", "broadcast", "channels", "crm", "inbox"]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(logger.error).mock.calls[0]![0])).toMatch(/NÃO EXISTE/);
  });

  it("qualquer outro código continua lançando", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(entitlementsDaOrg(ORG)).rejects.toThrow(/entitlements_unavailable/);
  });
});

describe("orgTemRecurso", () => {
  it("channels responde true SEM ir ao banco", async () => {
    expect(await orgTemRecurso(ORG, "channels")).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("vendável pergunta ao banco e responde pelo conjunto", async () => {
    rpc.mockResolvedValue({ data: { features: ["crm"], overrides: [] }, error: null });
    expect(await orgTemRecurso(ORG, "crm")).toBe(true);
    expect(await orgTemRecurso(ORG, "ai_agents")).toBe(false);
  });
});
