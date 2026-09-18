import { describe, expect, it } from "vitest";

import {
  CHAVES_DE_LIMITE,
  LIMITES,
  lerLimites,
  limitesSchema,
  mesclarLimites,
  tetoDe,
} from "./limites";
import { RECURSOS } from "./recursos";

describe("registro de limites", () => {
  it("toda chave tem meta, e a meta aponta para si mesma", () => {
    for (const chave of CHAVES_DE_LIMITE) {
      expect(LIMITES[chave].chave).toBe(chave);
      expect(LIMITES[chave].rotulo.trim().length).toBeGreaterThan(0);
      expect((RECURSOS as readonly string[]).includes(LIMITES[chave].recurso), `${chave} aponta para recurso desconhecido`).toBe(true);
    }
  });

  it("só se declara enforced quem tem rota recusando a criação — a lista é esta, e cada um tem teste de rota", () => {
    // max_channels: channel-sessions/route.test.ts · max_users: team/invite ·
    // max_ai_agents: ai/agents. Marcar `true` sem a rota é promessa vazia.
    const barram = CHAVES_DE_LIMITE.filter((c) => LIMITES[c].enforced).sort();
    expect(barram).toEqual(["max_ai_agents", "max_channels", "max_users"]);
  });
});

describe("lerLimites (tolerante)", () => {
  it("lê números e null, descarta chave desconhecida e valor inválido", () => {
    expect(
      lerLimites({ max_users: 10, max_ai_agents: null, max_contacts: -1, max_channels: "3", desconhecida: 5 }),
    ).toEqual({ max_users: 10, max_ai_agents: null });
  });

  it("não-objeto vira vazio, nunca lança", () => {
    expect(lerLimites(null)).toEqual({});
    expect(lerLimites(undefined)).toEqual({});
    expect(lerLimites("x")).toEqual({});
    expect(lerLimites([1])).toEqual({});
  });

  it("o schema estrito recusa o que a leitura tolerante descarta", () => {
    expect(limitesSchema.safeParse({ max_users: 1.5 }).success).toBe(false);
    expect(limitesSchema.safeParse({ max_users: 3, max_channels: null }).success).toBe(true);
    expect(limitesSchema.safeParse({}).success).toBe(true);
  });
});

describe("mesclarLimites", () => {
  it("a camada de cima vence por chave, e null remove o limite de baixo", () => {
    const plano = { max_users: 5, max_ai_agents: 1, max_contacts: 1000 };
    const override = { max_ai_agents: 3, max_contacts: null };
    const efetivo = mesclarLimites(plano, override);
    expect(efetivo).toEqual({ max_users: 5, max_ai_agents: 3, max_contacts: null });
    expect(tetoDe(efetivo, "max_users")).toBe(5);
    expect(tetoDe(efetivo, "max_ai_agents")).toBe(3);
    expect(tetoDe(efetivo, "max_contacts")).toBeUndefined();
    expect(tetoDe(efetivo, "max_channels")).toBeUndefined();
  });

  it("sem camadas devolve vazio", () => {
    expect(mesclarLimites()).toEqual({});
  });
});
