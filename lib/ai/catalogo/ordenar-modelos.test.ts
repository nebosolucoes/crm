import { describe, expect, it } from "vitest";

import { ordenarModelosPorNome } from "./ordenar-modelos";

const m = (display_name: string, model_id = display_name) => ({ display_name, model_id });

describe("ordenarModelosPorNome", () => {
  it("ordena pelo nome ignorando caixa e acento, com números em ordem natural", () => {
    const nomes = ordenarModelosPorNome([
      m("NVIDIA: Nemotron"),
      m("inclusionAI: Ling"),
      m("OpenAI: GPT-10"),
      m("Anthropic: Claude"),
      m("OpenAI: GPT-4"),
      m("Ágil: Modelo"),
    ]).map((x) => x.display_name);

    expect(nomes).toEqual([
      "Ágil: Modelo",
      "Anthropic: Claude",
      "inclusionAI: Ling",
      "NVIDIA: Nemotron",
      "OpenAI: GPT-4",
      "OpenAI: GPT-10",
    ]);
  });

  it("desempata nomes iguais pelo model_id e não altera a lista recebida", () => {
    const entrada = [m("Igual", "z/modelo"), m("Igual", "a/modelo")];
    expect(ordenarModelosPorNome(entrada).map((x) => x.model_id)).toEqual(["a/modelo", "z/modelo"]);
    expect(entrada[0]!.model_id).toBe("z/modelo");
  });
});
