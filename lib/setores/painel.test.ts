import { describe, expect, it } from "vitest";

import { agruparPainelPorSetor, ROTULO_SEM_SETOR } from "./painel";

const FIN = { id: "fin", name: "Financeiro" };
const COM = { id: "com", name: "Comercial" };

describe("agruparPainelPorSetor", () => {
  it("uma linha por setor ativo (em ordem alfabética) e a linha Sem setor por último, mesmo zeradas", () => {
    const linhas = agruparPainelPorSetor({ setores: [FIN, COM], abertas: [], respondidas: [], transferencias: [], handoffs: [] });
    expect(linhas.map((l) => l.nome)).toEqual(["Comercial", "Financeiro", ROTULO_SEM_SETOR]);
    expect(linhas.every((l) => l.semDono === 0 && l.comDono === 0 && l.respondidas === 0)).toBe(true);
  });

  it("conta sem dono e com dono por setor, e a conversa sem setor cai na linha Sem setor", () => {
    const linhas = agruparPainelPorSetor({
      setores: [FIN, COM],
      abertas: [
        { sector_id: "fin", assigned_to_user_id: null },
        { sector_id: "fin", assigned_to_user_id: "ana" },
        { sector_id: "fin", assigned_to_user_id: "ana" },
        { sector_id: null, assigned_to_user_id: null },
      ],
      respondidas: [{ sector_id: "fin" }, { sector_id: "com" }, { sector_id: null }],
      transferencias: [{ from_sector_id: "com" }, { from_sector_id: "com" }, { from_sector_id: null }],
      handoffs: [{ sector_id: "fin" }],
    });
    const por = Object.fromEntries(linhas.map((l) => [l.nome, l]));
    expect(por.Financeiro).toMatchObject({ semDono: 1, comDono: 2, respondidas: 1, transferidasParaFora: 0, handoffsRecebidos: 1 });
    expect(por.Comercial).toMatchObject({ semDono: 0, comDono: 0, respondidas: 1, transferidasParaFora: 2 });
    expect(por[ROTULO_SEM_SETOR]).toMatchObject({ semDono: 1, respondidas: 1, transferidasParaFora: 1 });
  });

  it("setor inativo ou apagado conta como Sem setor — é como a RLS o trata", () => {
    const linhas = agruparPainelPorSetor({
      setores: [FIN],
      abertas: [{ sector_id: "sumiu", assigned_to_user_id: null }],
      respondidas: [],
      transferencias: [{ from_sector_id: "sumiu" }],
      handoffs: [],
    });
    expect(linhas.map((l) => l.nome)).toEqual(["Financeiro", ROTULO_SEM_SETOR]);
    expect(linhas[1]).toMatchObject({ semDono: 1, transferidasParaFora: 1 });
  });
});
