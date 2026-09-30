import { beforeEach, describe, expect, it, vi } from "vitest";

const entitlementsDaOrg = vi.fn();
vi.mock("./resolver", () => ({ entitlementsDaOrg: (o: string) => entitlementsDaOrg(o) }));

const { consumoDaOrg, limiteAtingido } = await import("./consumo");

const ORG = "22222222-2222-4222-8222-222222222222";

/** Admin fake: `from(tabela)` → builder encadeável cuja contagem vem de `contagens[tabela]`. */
function admin(
  contagens: Record<string, number>,
  registrar?: (tabela: string, ops: Array<[string, unknown[]]>) => void,
  extras: Array<{ limit_key: string; quantidade: number }> = [],
) {
  return {
    from: (tabela: string) => {
      const ops: Array<[string, unknown[]]> = [];
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "gt", "gte", "in"]) {
        b[m] = (...a: unknown[]) => {
          ops.push([m, a]);
          return b;
        };
      }
      b.then = (res: (v: unknown) => void) => {
        registrar?.(tabela, ops);
        res({ count: contagens[tabela] ?? 0, data: tabela === "organization_limit_extras" ? extras : null, error: null });
      };
      return b;
    },
  } as never;
}

beforeEach(() => {
  entitlementsDaOrg.mockReset();
});

describe("consumoDaOrg", () => {
  it("mede as seis chaves, sempre filtrando organization_id, e marca excedido só com teto", async () => {
    const filtros: Record<string, unknown[]> = {};
    const a = admin(
      { channel_sessions: 2, user_organizations: 3, team_invites: 1, ai_agents: 1, scheduled_group_message_runs: 40, contacts: 500, sectors: 2 },
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
    expect(por.max_sectors).toMatchObject({ teto: undefined, uso: 2, enforced: true });
    for (const tabela of Object.keys(filtros)) {
      expect(filtros[tabela], `${tabela} sem filtro de organization_id`).toEqual(expect.arrayContaining([["organization_id", ORG]]));
    }
  });
});

describe("conexões por rede e extras (spec 21 §10)", () => {
  it("o extra SOMA ao teto do plano; sem teto no plano segue sem teto", async () => {
    const a = admin({ channel_sessions: 3 }, undefined, [
      { limit_key: "max_instagram", quantidade: 2 },
      { limit_key: "max_instagram", quantidade: 1 },
      { limit_key: "max_messenger", quantidade: 5 },
    ]);
    const medidas = await consumoDaOrg(a, ORG, { max_instagram: 1 });
    const por = Object.fromEntries(medidas.map((m) => [m.chave, m]));
    expect(por.max_instagram).toMatchObject({ teto: 4, extra: 3, uso: 3, excedido: false, enforced: true });
    // Messenger sem teto no plano: o extra não inventa um teto.
    expect(por.max_messenger).toMatchObject({ teto: undefined, extra: 0 });
  });

  it("a contagem por rede filtra a rede e só canais de mensagem", async () => {
    const filtros: Array<[string, unknown[]]>[] = [];
    const a = admin({ channel_sessions: 1 }, (tabela, ops) => {
      if (tabela === "channel_sessions") filtros.push(ops);
    });
    await consumoDaOrg(a, ORG, {});
    const daRede = filtros.find((ops) => ops.some(([m, args]) => m === "eq" && args[0] === "platform" && args[1] === "instagram"));
    expect(daRede, "nenhuma contagem filtrou platform=instagram").toBeTruthy();
    expect(daRede!.some(([m, args]) => m === "in" && args[0] === "provider")).toBe(true);
  });

  it("limiteAtingido usa o teto COM extra", async () => {
    entitlementsDaOrg.mockResolvedValue({ limits: { max_instagram: 1 } });
    const extras = [{ limit_key: "max_instagram", quantidade: 1 }];
    expect(await limiteAtingido(admin({ channel_sessions: 1 }, undefined, extras), ORG, "max_instagram")).toBeNull();
    expect(await limiteAtingido(admin({ channel_sessions: 2 }, undefined, extras), ORG, "max_instagram")).toEqual({ teto: 2, uso: 2 });
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
