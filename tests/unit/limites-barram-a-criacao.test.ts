/**
 * Os limites do plano BARRAM a criação onde `LIMITES[chave].enforced = true`
 * (etapa 8): no teto, a rota responde 409 `limit_reached` ANTES de gravar ou
 * de mandar e-mail; abaixo dele, segue como sempre. O que se prova aqui é o
 * encaixe do gate na rota — a régua (`limiteAtingido`) tem suíte própria.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: USER, email: "a@x.com", full_name: "A", idioma: "pt-BR", is_platform_admin: false, organizations: [] },
    org: { orgId: ORG, name: "Org", role: "admin" },
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));
const limiteAtingido = vi.fn(async (..._a: unknown[]): Promise<{ teto: number; uso: number } | null> => null);
vi.mock("@/lib/entitlements/consumo", () => ({ limiteAtingido: (...a: unknown[]) => limiteAtingido(...a) }));
vi.mock("@/lib/entitlements/resolver", () => ({ orgTemRecurso: async () => true }));

const escritas: string[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order", "limit", "maybeSingle", "single"]) b[m] = () => b;
      b.insert = () => {
        escritas.push(tabela);
        return b;
      };
      b.then = (res: (v: unknown) => void) => res({ data: null, error: null, count: 0 });
      return b;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));

beforeEach(() => {
  limiteAtingido.mockReset();
  limiteAtingido.mockResolvedValue(null);
  escritas.length = 0;
});

describe("POST /api/v1/ai/agents × max_ai_agents", () => {
  it("no teto: 409 limit_reached, nada gravado, e a pergunta foi pela chave certa", async () => {
    limiteAtingido.mockResolvedValue({ teto: 1, uso: 1 });
    const { POST } = await import("@/app/api/v1/ai/agents/route");
    const r = await POST(
      new NextRequest("http://localhost/api/v1/ai/agents", { method: "POST", body: JSON.stringify({ name: "Novo" }), headers: { "content-type": "application/json" } }),
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("limit_reached");
    expect(limiteAtingido).toHaveBeenCalledWith(expect.anything(), ORG, "max_ai_agents");
    expect(escritas).toEqual([]);
  });
});

describe("POST /api/v1/team/invite × max_users", () => {
  it("no teto: 409 antes de qualquer envio", async () => {
    limiteAtingido.mockResolvedValue({ teto: 5, uso: 5 });
    const { POST } = await import("@/app/api/v1/team/invite/route");
    const r = await POST(
      new NextRequest("http://localhost/api/v1/team/invite", {
        method: "POST",
        body: JSON.stringify({ invitations: [{ email: "novo@x.com", role: "agent" }] }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error.details).toEqual({ limite: "max_users", teto: 5, uso: 5 });
    expect(limiteAtingido).toHaveBeenCalledWith(expect.anything(), ORG, "max_users");
    expect(escritas).toEqual([]);
  });
});
