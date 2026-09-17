/**
 * POST /api/v1/admin/plans — o Zod recusa recurso fora do vocabulário e
 * `channels` como escolha; slug repetido é 409; o caminho feliz grava plano +
 * recursos e audita `plan.created`. GET audita a leitura como todo `admin/`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requirePlatformAdminApi = vi.fn();
vi.mock("@/lib/auth/requirePlatformAdminApi", () => ({
  requirePlatformAdminApi: (o: unknown) => requirePlatformAdminApi(o),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const criarPlano = vi.fn();
const listarPlanos = vi.fn(async () => []);
vi.mock("@/lib/entitlements/admin/planos", () => ({
  criarPlano: (...a: unknown[]) => criarPlano(...a),
  listarPlanos: () => listarPlanos(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { GET, POST } = await import("./route");
const { audit } = await import("@/lib/audit");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/v1/admin/plans", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  criarPlano.mockReset();
  vi.mocked(audit).mockClear();
  requirePlatformAdminApi.mockResolvedValue({ ok: true, user: { id: ADMIN_ID }, scope: "full", mfaRequired: false });
});

describe("/admin/plans", () => {
  it("GET lista e audita platform_admin.plans_listed", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "platform_admin.plans_listed", actorUserId: ADMIN_ID }));
  });

  it("POST recusa `channels` como recurso escolhido e recurso desconhecido (422)", async () => {
    expect((await POST(req({ slug: "x", name: "X", features: ["channels"] }))).status).toBe(422);
    expect((await POST(req({ slug: "x", name: "X", features: ["agenda_v2"] }))).status).toBe(422);
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("POST cria e audita plan.created com recursos e limites", async () => {
    criarPlano.mockResolvedValue({
      ok: true,
      plano: { id: "p1", slug: "starter", name: "Starter", features: ["inbox"], limits: { max_users: 5 }, is_default: false },
    });
    const r = await POST(req({ slug: "starter", name: "Starter", features: ["inbox", "inbox"], limits: { max_users: 5 } }));
    expect(r.status).toBe(201);
    // Duplicata no array é desduplicada pelo schema antes de chegar ao catálogo.
    expect(criarPlano).toHaveBeenCalledWith({}, ADMIN_ID, expect.objectContaining({ features: ["inbox"] }));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan.created", resourceId: "p1", metadata: expect.objectContaining({ slug: "starter", features: ["inbox"] }) }),
    );
  });

  it("POST com slug repetido → 409 state_conflict (idempotência natural)", async () => {
    criarPlano.mockResolvedValue({ ok: false, codigo: "slug_em_uso" });
    const r = await POST(req({ slug: "starter", name: "Starter", features: [] }));
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("state_conflict");
  });
});
