import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * PUT /api/v1/sectors/[id]/members — a lista inteira substitui o conjunto, e a
 * ordem das escritas nunca deixa o setor vazio no meio do caminho: primeiro
 * entram os novos (upsert), depois saem os que não estão na lista.
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

import { PUT } from "@/app/api/v1/sectors/[id]/members/route";

const ORG = "a1a30000-0000-4000-8000-000000000001";
const MANAGER = "a1a30000-0000-4000-8000-000000000002";
const SETOR = "a1a30000-0000-4000-8000-000000000003";
const ANA = "a1a30000-0000-4000-8000-000000000011";
const BRUNO = "a1a30000-0000-4000-8000-000000000012";
const VIEWER = "a1a30000-0000-4000-8000-000000000013";
const DE_FORA = "a1a30000-0000-4000-8000-000000000014";

type Linha = Record<string, unknown>;
/** Membros ativos da organização, como o banco devolveria (viewer incluso; DE_FORA não). */
const MEMBROS = [
  { user_id: ANA, role: "agent" },
  { user_id: BRUNO, role: "manager" },
  { user_id: VIEWER, role: "viewer" },
];
let escritas: Array<{ op: string; detalhe: unknown }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  escritas = [];
  h.apoio.mockResolvedValue(null);
  h.guard.mockResolvedValue({ ok: true, user: { id: MANAGER, idioma: "pt-BR" }, org: { orgId: ORG, role: "manager" } });
  h.fromAdmin.mockImplementation((tabela: string) => {
    let pedidos: string[] = [];
    const cadeia = {
      select: () => cadeia,
      eq: () => cadeia,
      is: () => cadeia,
      in: (_c: string, v: string[]) => {
        pedidos = v;
        return cadeia;
      },
      maybeSingle: async () => ({ data: tabela === "sectors" ? { id: SETOR } : null, error: null }),
      then: (r: (v: unknown) => unknown) => r({ data: MEMBROS.filter((m) => pedidos.includes(m.user_id)), error: null }),
    };
    return cadeia;
  });
  h.fromSessao.mockImplementation((tabela: string) => {
    const cadeia = {
      upsert: async (linhas: Linha[], opts: unknown) => {
        escritas.push({ op: `upsert:${tabela}`, detalhe: { linhas, opts } });
        return { error: null };
      },
      delete: () => {
        const del = {
          eq: () => del,
          not: (_c: string, _op: string, v: string) => {
            escritas.push({ op: `delete-not-in:${tabela}`, detalhe: v });
            return del;
          },
          then: (r: (v: unknown) => unknown) => {
            if (!escritas.some((e) => e.op.startsWith("delete"))) escritas.push({ op: `delete-all:${tabela}`, detalhe: null });
            return r({ error: null });
          },
        };
        return del;
      },
    };
    return cadeia;
  });
});

const put = (corpo: unknown) =>
  PUT(new NextRequest(`https://crm.exemplo/api/v1/sectors/${SETOR}/members`, { method: "PUT", body: JSON.stringify(corpo) }), {
    params: Promise.resolve({ id: SETOR }),
  });

describe("PUT /api/v1/sectors/[id]/members", () => {
  it("entram os novos antes de saírem os ausentes, e audita a lista final", async () => {
    const res = await put({ user_ids: [ANA, BRUNO, ANA] });
    expect(res.status).toBe(200);
    expect(escritas.map((e) => e.op)).toEqual(["upsert:sector_members", "delete-not-in:sector_members"]);
    const upsert = escritas[0]!.detalhe as { linhas: Linha[]; opts: Linha };
    expect(upsert.linhas).toEqual([
      { organization_id: ORG, sector_id: SETOR, user_id: ANA },
      { organization_id: ORG, sector_id: SETOR, user_id: BRUNO },
    ]);
    expect(upsert.opts).toMatchObject({ ignoreDuplicates: true });
    expect(escritas[1]!.detalhe).toBe(`(${ANA},${BRUNO})`);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sector.members_changed", metadata: { user_ids: [ANA, BRUNO] } }));
  });

  it("lista vazia esvazia o setor (escolha explícita), sem upsert", async () => {
    expect((await put({ user_ids: [] })).status).toBe(200);
    expect(escritas.map((e) => e.op)).toEqual(["delete-all:sector_members"]);
  });

  it("viewer e quem não é da organização são recusados pelo nome, sem escrever", async () => {
    const res = await put({ user_ids: [ANA, VIEWER, DE_FORA] });
    expect(res.status).toBe(422);
    const { error } = (await res.json()) as { error: { details: Linha } };
    expect(error.details).toEqual({ user_ids: [VIEWER, DE_FORA] });
    expect(escritas).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
