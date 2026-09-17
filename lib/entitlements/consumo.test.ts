import { beforeEach, describe, expect, it, vi } from "vitest";

const entitlementsDaOrg = vi.fn();
vi.mock("./resolver", () => ({ entitlementsDaOrg: (o: string) => entitlementsDaOrg(o) }));

const { consumoDaOrg, limiteAtingido } = await import("./consumo");

const ORG = "22222222-2222-4222-8222-222222222222";

/** Admin fake: `from(tabela)` → builder encadeável cuja contagem vem de `contagens[tabela]`. */
function admin(contagens: Record<string, number>, registrar?: (tabela: string, ops: Array<[string, unknown[]]>) => void) {
  return {
    from: (tabela: string) => {
      const ops: Array<[string, unknown[]]> = [];
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "gt", "gte"]) {
        b[m] = (...a: unknown[]) => {
          ops.push([m, a]);
          return b;
        };
      }
      b.then = (res: (v: unknown) => void) => {
        registrar?.(tabela, ops);
        res({ count: contagens[tabela] ?? 0, error: null });
      };
      return b;
    },
  } as never;
}

beforeEach(() => {
  entitlementsDaOrg.mockReset();
});

describe("consumoDaOrg", () => {
  it("mede as cinco chaves, sempre filtrando organization_id, e marca excedido só com teto", async () => {
    const filtros: Record<string, unknown[]> = {};
    const a = admin(
      { channel_sessions: 2, user_organizations: 3, team_invites: 1, ai_agents: 1, scheduled_group_message_runs: 40, contacts: 500 },
      (tabela, ops) => {
        filtros[tabela] = ops.filter(([m]) => m === "eq").map(([, a]) => a);
      },
    );
    const medidas = await consumoDaOrg(a, ORG, { max_channels: 2, max_users: 10, max_ai_agents: null }, new Date("2026-09-17T12:00:00Z"));
    const por = Object.fromEntries(medidas.map((m) => [m.chave, m]));
    expect(por.max_channels).toMatchObject({ teto: 2, uso: 2, excedido: true, enforced: true });
    expect(por.max_users).toMatchObject({ teto: 10, uso: 4, excedido: false, enforced: true }); // 3 membros + 1 convite
    expect(por.max_ai_agents).toMatchObject({ teto: undefined, uso: 1, excedido: false });
    expect(por.broadcast_monthly_sends).toMatchObject({ teto: undefined, uso: 40, enforced: false });
    expect(por.max_contacts).toMatchObject({ teto: undefined, uso: 500, enforced: false });
    for (const tabela of Object.keys(filtros)) {
      expect(filtros[tabela], `${tabela} sem filtro de organization_id`).toEqual(expect.arrayContaining([["organization_id", ORG]]));
    }
  });
});

describe("limiteAtingido", () => {
  it("sem teto: null, e NEM conta — organização sem limite não paga a contagem", async () => {
    entitlementsDaOrg.mockResolvedValue({ limits: {} });
    const chamadas: string[] = [];
    const a = admin({ channel_sessions: 99 }, (t) => chamadas.push(t));
    expect(await limiteAtingido(a, ORG, "max_channels")).toBeNull();
    expect(chamadas).toEqual([]);
  });

  it("abaixo do teto: null; no teto ou acima: { teto, uso }", async () => {
    entitlementsDaOrg.mockResolvedValue({ limits: { max_ai_agents: 2 } });
    expect(await limiteAtingido(admin({ ai_agents: 1 }), ORG, "max_ai_agents")).toBeNull();
    expect(await limiteAtingido(admin({ ai_agents: 2 }), ORG, "max_ai_agents")).toEqual({ teto: 2, uso: 2 });
    expect(await limiteAtingido(admin({ ai_agents: 5 }), ORG, "max_ai_agents")).toEqual({ teto: 2, uso: 5 });
  });

  it("teto 0 barra a primeira criação", async () => {
    entitlementsDaOrg.mockResolvedValue({ limits: { max_users: 0 } });
    expect(await limiteAtingido(admin({}), ORG, "max_users")).toEqual({ teto: 0, uso: 0 });
  });
});
