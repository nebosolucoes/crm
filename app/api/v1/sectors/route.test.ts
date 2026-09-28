import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * /api/v1/sectors — o que a rota promete além do que a RLS e a RPC já provam
 * em tests/invariants/setores-de-atendimento.test.ts:
 *
 *   - o limite `max_sectors` barra ANTES de gravar (é o que faz `enforced: true`
 *     em lib/entitlements/limites.ts ser verdade, e não promessa);
 *   - o slug é derivado do nome quando não vem, e slug repetido vira 409 nomeado;
 *   - toda criação audita `sector.created`;
 *   - a listagem achata `sector_members` em `members: string[]`.
 */
const h = vi.hoisted(() => ({
  guard: vi.fn(),
  apoio: vi.fn(),
  audit: vi.fn(),
  limite: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.guard }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.apoio }));
vi.mock("@/lib/audit", () => ({ audit: h.audit, isServiceRoleConfigured: () => true }));
vi.mock("@/lib/entitlements/exigir-na-rota", () => ({ recusaPorLimite: h.limite }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: h.from }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: h.from }) }));

import { GET, POST } from "@/app/api/v1/sectors/route";

const ORG = "a1a10000-0000-4000-8000-000000000001";
const USER = "a1a10000-0000-4000-8000-000000000002";

type Linha = Record<string, unknown>;
let inseridos: Linha[] = [];
let erroDoInsert: { code: string; message: string } | null = null;
let listagem: Linha[] = [];

function banco() {
  h.from.mockImplementation((tabela: string) => {
    if (tabela !== "sectors") throw new Error(`tabela inesperada: ${tabela}`);
    const cadeia = {
      select: () => cadeia,
      eq: () => cadeia,
      order: () => cadeia,
      then: (r: (v: unknown) => unknown) => r({ data: listagem, error: null }),
      insert: (linha: Linha) => ({
        select: () => ({
          single: async () => {
            if (erroDoInsert) return { data: null, error: erroDoInsert };
            const criado = { id: `set-${inseridos.length + 1}`, ...linha };
            inseridos.push(criado);
            return { data: criado, error: null };
          },
        }),
      }),
    };
    return cadeia;
  });
}

function post(corpo: unknown): Promise<Response> {
  return POST(new NextRequest("https://crm.exemplo/api/v1/sectors", { method: "POST", body: JSON.stringify(corpo) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  inseridos = [];
  erroDoInsert = null;
  listagem = [];
  h.apoio.mockResolvedValue(null);
  h.limite.mockResolvedValue(null);
  h.guard.mockResolvedValue({ ok: true, user: { id: USER, idioma: "pt-BR" }, org: { orgId: ORG, role: "manager" } });
  banco();
});

describe("POST /api/v1/sectors", () => {
  it("cria com slug derivado do nome, devolve members vazio e audita", async () => {
    const res = await post({ name: "Financeiro & Cobrança", description: "boletos" });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: Linha };
    expect(data).toMatchObject({ slug: "financeiro-cobranca", scope: "own", members: [] });
    expect(inseridos[0]).toMatchObject({ organization_id: ORG, created_by: USER, slug: "financeiro-cobranca" });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sector.created", organizationId: ORG, actorUserId: USER }));
  });

  it("o limite do plano barra antes de gravar", async () => {
    const { NextResponse } = await import("next/server");
    h.limite.mockResolvedValue(NextResponse.json({ error: { code: "limit_reached" } }, { status: 409 }));
    const res = await post({ name: "Suporte" });
    expect(res.status).toBe(409);
    expect(h.limite).toHaveBeenCalledWith(ORG, "max_sectors", expect.objectContaining({ actorUserId: USER }));
    expect(inseridos).toHaveLength(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("recusa payload inválido (422) e slug repetido (409), sem auditar", async () => {
    expect((await post({ name: "", scope: "tudo" })).status).toBe(422);
    expect((await post({ name: "X", slug: "Com Espaço" })).status).toBe(422);
    erroDoInsert = { code: "23505", message: "duplicate key" };
    const res = await post({ name: "Financeiro" });
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as { error: { code: string; details: Linha } };
    expect(error.code).toBe("state_conflict");
    expect(error.details).toEqual({ slug: "financeiro" });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("nome só de símbolos não vira slug vazio", async () => {
    const res = await post({ name: "!!!" });
    expect(res.status).toBe(422);
    expect(inseridos).toHaveLength(0);
  });
});

describe("GET /api/v1/sectors", () => {
  it("achata os membros e passa pela guarda de agent", async () => {
    listagem = [{ id: "s1", name: "Financeiro", sector_members: [{ user_id: "u1" }, { user_id: "u2" }] }];
    const res = await GET();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Linha[] };
    expect(data).toEqual([{ id: "s1", name: "Financeiro", members: ["u1", "u2"] }]);
    expect(h.guard).toHaveBeenCalledWith("agent", expect.objectContaining({ feature: "inbox" }));
  });
});
