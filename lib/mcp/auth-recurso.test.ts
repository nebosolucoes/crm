import { beforeEach, describe, expect, it, vi } from "vitest";

const orgTemRecurso = vi.fn(async (_org: string, _recurso: string) => true);
vi.mock("@/lib/entitlements/resolver", () => ({ orgTemRecurso: (o: string, r: string) => orgTemRecurso(o, r) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

const { ensureRecurso, MCP_CODE_FEATURE_NOT_ENTITLED, McpAuthError } = await import("./auth");
type ErroMcp = InstanceType<typeof McpAuthError>;

const ORG = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  orgTemRecurso.mockReset();
  orgTemRecurso.mockResolvedValue(true);
});

describe("ensureRecurso (MCP × plano)", () => {
  it("tool do produto passa sem consultar o plano", async () => {
    await ensureRecurso(ORG, "crm_list_webhook_sources");
    expect(orgTemRecurso).not.toHaveBeenCalled();
  });

  it("tool vendável consulta o plano da organização e passa com o recurso", async () => {
    await ensureRecurso(ORG, "crm_create_lead");
    expect(orgTemRecurso).toHaveBeenCalledWith(ORG, "crm");
  });

  it("sem o recurso → McpAuthError 403 com o código próprio de plano", async () => {
    orgTemRecurso.mockResolvedValue(false);
    const erro = await ensureRecurso(ORG, "crm_create_lead").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(McpAuthError);
    expect((erro as ErroMcp).httpStatus).toBe(403);
    expect((erro as ErroMcp).mcpCode).toBe(MCP_CODE_FEATURE_NOT_ENTITLED);
    expect((erro as ErroMcp).message).toMatch(/feature_not_entitled: 'crm'/);
  });

  it("tool desconhecida é recusada FECHADA, não liberada", async () => {
    const erro = await ensureRecurso(ORG, "tool_inventada").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(McpAuthError);
    expect(orgTemRecurso).not.toHaveBeenCalled();
  });
});
