import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { foraDosMeusSetores } from "@/lib/setores/transferencia";

/**
 * A LISTA DE TRANSFERÊNCIA OFERECE SÓ QUEM O SERVIDOR ACEITA.
 *
 * Produção, 03/11/2026: 3 recusas 422 "Você só pode transferir para pessoas dos
 * seus setores." — a janela listava a organização inteira e a atendente só
 * descobria a regra depois de escolher. A regra agora mora em
 * `lib/setores/transferencia.ts`, usada pelo servidor da transferência (que
 * continua recusando) e pela rota `team/assignable` (que marca `pode_receber`).
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ isServiceRoleConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const banco = vi.hoisted(() => ({
  tabelas: {} as Record<string, Array<Record<string, unknown>>>,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      let rows = [...(banco.tabelas[tabela] ?? [])];
      const chain = {
        select: () => chain,
        // Filtros de coluna aninhada (`sectors.is_active`) ficam com o dublê:
        // `sector_members` aqui só tem setores ativos.
        eq: (col: string, val: unknown) => (
          col.includes(".") ? null : (rows = rows.filter((r) => r[col] === val)), chain
        ),
        neq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] !== val)), chain),
        is: (col: string, val: unknown) => ((rows = rows.filter((r) => (r[col] ?? null) === val)), chain),
        in: (col: string, vals: unknown[]) => ((rows = rows.filter((r) => vals.includes(r[col]))), chain),
        order: () => chain,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
      };
      return chain;
    },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { user_metadata: { full_name: id } } } }) } },
  }),
}));

import { requireRole } from "@/lib/auth/require-role";

const ORG = "org-1";

function membros(...ids: string[]) {
  return ids.map((user_id) => ({ organization_id: ORG, user_id, role: "agent", revoked_at: null }));
}

async function chamaComo(userId: string, role: string) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: userId },
    org: { orgId: ORG, role },
  } as never);
  const { GET } = await import("@/app/api/v1/team/assignable/route");
  const res = await GET(new NextRequest("http://x/api/v1/team/assignable"));
  const body = (await res.json()) as { data: Array<{ user_id: string; pode_receber: boolean }> };
  return Object.fromEntries(body.data.map((m) => [m.user_id, m.pode_receber]));
}

describe("foraDosMeusSetores — a regra pura", () => {
  it("quem não está em setor nenhum não é restringido", () => {
    expect(foraDosMeusSetores(new Set(), new Set(["s1"]))).toBe(false);
    expect(foraDosMeusSetores(new Set(), undefined)).toBe(false);
  });

  it("em setor: só quem divide ao menos um", () => {
    expect(foraDosMeusSetores(new Set(["s1", "s2"]), new Set(["s2"]))).toBe(false);
    expect(foraDosMeusSetores(new Set(["s1"]), new Set(["s2"]))).toBe(true);
    expect(foraDosMeusSetores(new Set(["s1"]), undefined)).toBe(true);
  });
});

describe("GET /api/v1/team/assignable — pode_receber", () => {
  beforeEach(() => {
    vi.resetModules();
    banco.tabelas = {
      user_organizations: membros("eu", "colega-do-setor", "colega-de-fora", "sem-setor"),
      sector_members: [
        { organization_id: ORG, user_id: "eu", sector_id: "vendas" },
        { organization_id: ORG, user_id: "colega-do-setor", sector_id: "vendas" },
        { organization_id: ORG, user_id: "colega-de-fora", sector_id: "financeiro" },
      ],
    };
  });

  it("atendente em setor: só quem divide o setor pode receber", async () => {
    expect(await chamaComo("eu", "agent")).toEqual({
      eu: true,
      "colega-do-setor": true,
      "colega-de-fora": false,
      "sem-setor": false,
    });
  });

  it("atendente sem setor: todos podem receber (comportamento de antes da spec 20)", async () => {
    const r = await chamaComo("sem-setor", "agent");
    expect(Object.values(r).every(Boolean)).toBe(true);
  });

  it("organização sem setores: todos podem receber", async () => {
    banco.tabelas.sector_members = [];
    const r = await chamaComo("eu", "agent");
    expect(Object.values(r).every(Boolean)).toBe(true);
  });

  it("gerente não é restringido, mesmo estando em setor", async () => {
    const r = await chamaComo("eu", "manager");
    expect(Object.values(r).every(Boolean)).toBe(true);
  });
});
