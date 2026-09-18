/**
 * POST /api/v1/admin/tenants/[id]/overrides — o Zod recusa desligar Canais e
 * janela invertida ANTES do banco; o caminho feliz vai pela RPC com o ator,
 * audita `tenant.feature_override_created` e avisa a organização.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requirePlatformAdminApi = vi.fn();
vi.mock("@/lib/auth/requirePlatformAdminApi", () => ({
  requirePlatformAdminApi: (o: unknown) => requirePlatformAdminApi(o),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const rpc = vi.fn();
const inserts: Array<{ tabela: string; linha: unknown }> = [];
const admin = {
  rpc,
  from: (tabela: string) => ({
    insert: async (linha: unknown) => {
      inserts.push({ tabela, linha });
      return { error: null };
    },
  }),
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const { POST } = await import("./route");
const { audit } = await import("@/lib/audit");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

function req(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/admin/tenants/${ORG_ID}/overrides`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const ctx = { params: Promise.resolve({ id: ORG_ID }) };

beforeEach(() => {
  rpc.mockReset();
  inserts.length = 0;
  vi.mocked(audit).mockClear();
  requirePlatformAdminApi.mockResolvedValue({ ok: true, user: { id: ADMIN_ID }, scope: "full", mfaRequired: false });
});

describe("POST /admin/tenants/[id]/overrides", () => {
  it("desligar Canais é recusado pelo Zod (422), antes do banco", async () => {
    const r = await POST(req({ feature: "channels", mode: "disable", reason: "teste de recusa" }), ctx);
    expect(r.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fim antes do início é recusado (422)", async () => {
    const r = await POST(
      req({ feature: "crm", mode: "enable", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-09-01T00:00:00Z", reason: "janela torta" }),
      ctx,
    );
    expect(r.status).toBe(422);
  });

  it("libera IA por 30 dias: RPC com o ator, 201, audit com a janela, aviso na Central com 'até'", async () => {
    rpc.mockResolvedValue({ data: "44444444-4444-4444-8444-444444444444", error: null });
    const r = await POST(
      req({ feature: "ai_agents", mode: "enable", ends_at: "2026-10-17T00:00:00Z", limits: { max_ai_agents: 2 }, reason: "teste de 30 dias" }),
      ctx,
    );
    expect(r.status).toBe(201);
    expect((await r.json()).data.id).toBe("44444444-4444-4444-8444-444444444444");
    expect(rpc).toHaveBeenCalledWith(
      "fn_criar_override_de_recurso",
      expect.objectContaining({ p_actor: ADMIN_ID, p_org: ORG_ID, p_feature: "ai_agents", p_mode: "enable", p_limits: { max_ai_agents: 2 } }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.feature_override_created",
        organizationId: ORG_ID,
        metadata: expect.objectContaining({ feature: "ai_agents", mode: "enable", ends_at: "2026-10-17T00:00:00Z" }),
      }),
    );
    expect(inserts[0]).toEqual({
      tabela: "agent_inbox_items",
      linha: expect.objectContaining({ organization_id: ORG_ID, kind: "entitlement_changed", body: expect.stringContaining("até") }),
    });
  });

  it("sem escopo full, 403 sem tocar o banco", async () => {
    requirePlatformAdminApi.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const r = await POST(req({ feature: "crm", mode: "enable", reason: "qualquer" }), ctx);
    expect(r.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
