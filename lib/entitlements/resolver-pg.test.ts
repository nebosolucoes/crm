import { beforeEach, describe, expect, it, vi } from "vitest";

import { esquecerEntitlementsPg, orgTemRecursoPg, type ConsultaPg } from "./resolver-pg";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function db(respostas: Record<string, boolean>): ConsultaPg & { chamadas: unknown[][] } {
  const chamadas: unknown[][] = [];
  return {
    chamadas,
    query: vi.fn(async (_sql: string, values?: unknown[]) => {
      chamadas.push(values ?? []);
      const [org, recurso] = values as [string, string];
      return { rows: [{ tem: respostas[`${org}:${recurso}`] ?? false }] } as never;
    }),
  };
}

beforeEach(() => esquecerEntitlementsPg());

describe("orgTemRecursoPg", () => {
  it("channels responde true sem consultar", async () => {
    const d = db({});
    expect(await orgTemRecursoPg(d, ORG_A, "channels")).toBe(true);
    expect(d.chamadas).toEqual([]);
  });

  it("consulta fn_org_has_feature e lembra por 60 s, por (org, recurso)", async () => {
    const d = db({ [`${ORG_A}:crm`]: true, [`${ORG_A}:ai_agents`]: false, [`${ORG_B}:crm`]: false });
    const t0 = 1_000_000;
    expect(await orgTemRecursoPg(d, ORG_A, "crm", t0)).toBe(true);
    expect(await orgTemRecursoPg(d, ORG_A, "crm", t0 + 59_000)).toBe(true);
    expect(await orgTemRecursoPg(d, ORG_A, "ai_agents", t0)).toBe(false);
    expect(await orgTemRecursoPg(d, ORG_B, "crm", t0)).toBe(false);
    expect(d.chamadas).toHaveLength(3);
    expect(d.chamadas[0]).toEqual([ORG_A, "crm"]);
  });

  it("depois de 60 s pergunta de novo — a troca de plano chega ao worker em um minuto", async () => {
    const respostas = { [`${ORG_A}:crm`]: false };
    const d = db(respostas);
    const t0 = 1_000_000;
    expect(await orgTemRecursoPg(d, ORG_A, "crm", t0)).toBe(false);
    respostas[`${ORG_A}:crm`] = true;
    expect(await orgTemRecursoPg(d, ORG_A, "crm", t0 + 30_000), "ainda lembrado").toBe(false);
    expect(await orgTemRecursoPg(d, ORG_A, "crm", t0 + 60_001), "releu").toBe(true);
    expect(d.chamadas).toHaveLength(2);
  });

  it("esquecerEntitlementsPg(org) apaga só aquela organização", async () => {
    const d = db({ [`${ORG_A}:crm`]: true, [`${ORG_B}:crm`]: true });
    await orgTemRecursoPg(d, ORG_A, "crm");
    await orgTemRecursoPg(d, ORG_B, "crm");
    esquecerEntitlementsPg(ORG_A);
    await orgTemRecursoPg(d, ORG_A, "crm");
    await orgTemRecursoPg(d, ORG_B, "crm");
    expect(d.chamadas).toHaveLength(3);
  });

  it("erro da consulta LANÇA — quem chama decide degradar", async () => {
    const d: ConsultaPg = { query: vi.fn(async () => { throw new Error("connection refused"); }) };
    await expect(orgTemRecursoPg(d, ORG_A, "crm")).rejects.toThrow(/connection refused/);
  });
});
