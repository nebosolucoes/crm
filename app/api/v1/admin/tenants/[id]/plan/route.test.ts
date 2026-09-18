/**
 * PUT /api/v1/admin/tenants/[id]/plan — a atribuição passa pela RPC com o
 * ATOR (nunca pelo UPDATE direto), audita `tenant.plan_changed` e avisa a
 * organização na Central. Sem escopo `full`, 403; corpo torto, 422.
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
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { slug: "starter", name: "Starter" }, error: null }) }),
    }),
  }),
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const { PUT } = await import("./route");
const { audit } = await import("@/lib/audit");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";

function req(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/admin/tenants/${ORG_ID}/plan`, {
    method: "PUT",
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

describe("PUT /admin/tenants/[id]/plan", () => {
  it("exige platform admin com escrita (a recusa do helper é devolvida como está)", async () => {
    const recusa = new Response(null, { status: 403 });
    requirePlatformAdminApi.mockResolvedValue({ ok: false, response: recusa });
    const r = await PUT(req({ plan_id: PLAN_ID, reason: "contrato" }), ctx);
    expect(r.status).toBe(403);
    expect(requirePlatformAdminApi).toHaveBeenCalledWith(expect.objectContaining({ escrita: true }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("corpo torto → 422, sem tocar o banco", async () => {
    const r = await PUT(req({ plan_id: "nao-e-uuid", reason: "x" }), ctx);
    expect(r.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("atribui pela RPC com o ator, audita tenant.plan_changed e avisa a organização na Central", async () => {
    rpc.mockResolvedValue({ data: { changed: true, from_plan_id: null, to_plan_id: PLAN_ID }, error: null });
    const r = await PUT(req({ plan_id: PLAN_ID, reason: "contrato assinado" }), ctx);
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_definir_plano_da_organizacao", {
      p_actor: ADMIN_ID,
      p_org: ORG_ID,
      p_plan: PLAN_ID,
      p_reason: "contrato assinado",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.plan_changed",
        actorUserId: ADMIN_ID,
        organizationId: ORG_ID,
        actingAsPlatformAdmin: true,
        metadata: expect.objectContaining({ to_plan: "starter", reason: "contrato assinado" }),
      }),
    );
    expect(inserts).toEqual([
      { tabela: "agent_inbox_items", linha: expect.objectContaining({ organization_id: ORG_ID, kind: "entitlement_changed", severity: "info" }) },
    ]);
  });

  it("plano inativo: a RPC recusa e a rota traduz para 422 plan_inactive", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "plan_inactive", code: "23514" } });
    const r = await PUT(req({ plan_id: PLAN_ID, reason: "contrato" }), ctx);
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("plan_inactive");
    expect(audit).not.toHaveBeenCalled();
  });

  it("mesmo plano: changed=false, nada auditado, nada avisado", async () => {
    rpc.mockResolvedValue({ data: { changed: false, from_plan_id: PLAN_ID, to_plan_id: PLAN_ID }, error: null });
    const r = await PUT(req({ plan_id: PLAN_ID, reason: "repetido" }), ctx);
    expect(r.status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });
});
