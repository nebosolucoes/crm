import { describe, expect, it } from "vitest";

import { tokenizarFormatoDoWhatsApp } from "./formato-do-whatsapp";

describe("formato do WhatsApp", () => {
  it("negrito, itálico, riscado e mono viram estilo; o resto é texto", () => {
    expect(tokenizarFormatoDoWhatsApp("Oi *mundo* _leve_ ~não~ ```x```")).toEqual([
      { tipo: "texto", texto: "Oi " },
      { tipo: "estilo", estilo: "negrito", filhos: [{ tipo: "texto", texto: "mundo" }] },
      { tipo: "texto", texto: " " },
      { tipo: "estilo", estilo: "italico", filhos: [{ tipo: "texto", texto: "leve" }] },
      { tipo: "texto", texto: " " },
      { tipo: "estilo", estilo: "riscado", filhos: [{ tipo: "texto", texto: "não" }] },
      { tipo: "texto", texto: " " },
      { tipo: "estilo", estilo: "mono", filhos: [{ tipo: "texto", texto: "x" }] },
    ]);
  });

  it("marcador que não cola no texto fica literal — como no WhatsApp", () => {
    expect(tokenizarFormatoDoWhatsApp("2*3*4 e * solto *")).toEqual([
      { tipo: "texto", texto: "2*3*4 e * solto *" },
    ]);
    expect(tokenizarFormatoDoWhatsApp("*sem fechar")).toEqual([
      { tipo: "texto", texto: "*sem fechar" },
    ]);
  });

  it("não atravessa a quebra de linha, e a quebra vira token próprio", () => {
    expect(tokenizarFormatoDoWhatsApp("*a\nb*")).toEqual([
      { tipo: "texto", texto: "*a" },
      { tipo: "quebra" },
      { tipo: "texto", texto: "b*" },
    ]);
  });

  it("aninha de fora para dentro, e mono não interpreta nada", () => {
    expect(tokenizarFormatoDoWhatsApp("*_x_*")).toEqual([
      {
        tipo: "estilo",
        estilo: "negrito",
        filhos: [{ tipo: "estilo", estilo: "italico", filhos: [{ tipo: "texto", texto: "x" }] }],
      },
    ]);
    expect(tokenizarFormatoDoWhatsApp("```*x*```")).toEqual([
      { tipo: "estilo", estilo: "mono", filhos: [{ tipo: "texto", texto: "*x*" }] },
    ]);
  });
});
