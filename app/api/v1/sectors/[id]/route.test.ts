import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * DELETE /api/v1/sectors/[id] — apagar é o caminho EXCEPCIONAL (desativar é o
 * normal), e a rota tem que provar duas coisas:
 *
 *   - com conversa ABERTA no setor, 409 com a contagem e NADA é tocado;
 *   - sem conversa aberta, as referências que sobraram (conversas encerradas,
 *     agentes de IA) são anuladas ANTES do delete — a FK é restrict.
 */
const h = vi.hoisted(() => ({
  guard: vi.fn(),
  apoio: vi.fn(),
  audit: vi.fn(),
  fromSessao: vi.fn(),
  fromAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.guard }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.apoio }));
vi.mock("@/lib/audit", () => ({ audit: h.audit, isServiceRoleConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: h.fromSessao }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: h.fromAdmin }) }));

import { DELETE, PATCH } from "@/app/api/v1/sectors/[id]/route";

const ORG = "a1a20000-0000-4000-8000-000000000001";
const USER = "a1a20000-0000-4000-8000-000000000002";
const SETOR = "a1a20000-0000-4000-8000-000000000003";

type Linha = Record<string, unknown>;
let abertas = 0;
let existe = true;
/** `tabela` → colunas gravadas, na ordem em que a rota anulou. */
let anuladas: string[] = [];
let apagados: string[] = [];
let atualizado: Linha | null = null;

function bancoAdmin() {
  h.fromAdmin.mockImplementation((tabela: string) => {
    const cadeia = {
      select: () => cadeia,
      eq: () => cadeia,
      in: () => cadeia,
      maybeSingle: async () => ({ data: existe && tabela === "sectors" ? { id: SETOR, name: "Financeiro" } : null, error: null }),
      then: (r: (v: unknown) => unknown) => r({ count: abertas, error: null }),
      update: (linha: Linha) => {
        if (linha.sector_id === null) anuladas.push(tabela);
        const up = { eq: () => up, then: (r: (v: unknown) => unknown) => r({ error: null }) };
        return up;
      },
    };
    return cadeia;
  });
}

function bancoSessao() {
  h.fromSessao.mockImplementation((tabela: string) => {
    const cadeia = {
      delete: () => {
        apagados.push(tabela);
        return cadeia;
      },
      update: (linha: Linha) => {
        atualizado = linha;
        return cadeia;
      },
      eq: () => cadeia,
      select: () => cadeia,
      maybeSingle: async () => ({ data: existe ? { id: SETOR, name: "Financeiro", sector_members: [] } : null, error: null }),
    };
    return cadeia;
  });
}

const params = { params: Promise.resolve({ id: SETOR }) };
const del = () => DELETE(new NextRequest(`https://crm.exemplo/api/v1/sectors/${SETOR}`, { method: "DELETE" }), params);
const patch = (corpo: unknown) =>
  PATCH(new NextRequest(`https://crm.exemplo/api/v1/sectors/${SETOR}`, { method: "PATCH", body: JSON.stringify(corpo) }), params);

beforeEach(() => {
  vi.clearAllMocks();
  abertas = 0;
  existe = true;
  anuladas = [];
  apagados = [];
  atualizado = null;
  h.apoio.mockResolvedValue(null);
  h.guard.mockResolvedValue({ ok: true, user: { id: USER, idioma: "pt-BR" }, org: { orgId: ORG, role: "manager" } });
  bancoAdmin();
  bancoSessao();
});

describe("DELETE /api/v1/sectors/[id]", () => {
  it("com conversa aberta: 409 com a contagem, nada anulado, nada apagado, nada auditado", async () => {
    abertas = 3;
    const res = await del();
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as { error: { code: string; details: Linha } };
    expect(error.code).toBe("state_conflict");
    expect(error.details).toEqual({ open_conversations: 3 });
    expect(anuladas).toEqual([]);
    expect(apagados).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("sem conversa aberta: anula conversas e agentes antes, apaga pela sessão e audita", async () => {
    const res = await del();
    expect(res.status).toBe(204);
    expect(anuladas).toEqual(["conversations", "ai_agents"]);
    expect(apagados).toEqual(["sectors"]);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sector.deleted", resourceId: SETOR, organizationId: ORG }));
  });

  it("setor de outra organização (ou inexistente) é 404 sem tocar em nada", async () => {
    existe = false;
    expect((await del()).status).toBe(404);
    expect(anuladas).toEqual([]);
    expect(apagados).toEqual([]);
  });
});

describe("PATCH /api/v1/sectors/[id]", () => {
  it("grava só os campos enviados, achata membros e audita os campos", async () => {
    const res = await patch({ is_active: false, description: "só cobrança" });
    expect(res.status).toBe(200);
    expect(atualizado).toEqual({ is_active: false, description: "só cobrança" });
    const { data } = (await res.json()) as { data: Linha };
    expect(data).toMatchObject({ id: SETOR, members: [] });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sector.updated", metadata: { fields: expect.arrayContaining(["is_active", "description"]) } }));
  });

  it("corpo vazio ou campo desconhecido é 422", async () => {
    expect((await patch({})).status).toBe(422);
    expect((await patch({ cor: "azul" })).status).toBe(422);
    expect(atualizado).toBeNull();
  });
});
