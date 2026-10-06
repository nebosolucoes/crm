import { describe, expect, it } from "vitest";

import { INSTRUCAO_PADRAO, instrucoesEmVigor, salvarInstrucaoSchema } from "./instrucoes";
import { limiteDaLegenda, limparLegenda, MAXIMO_DE_IMAGENS_LIDAS, montarPedidoDeLegenda, sugerirLegendaSchema } from "./montar-pedido";

const img = (n: number) => Array.from({ length: n }, () => ({ data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" }));

function partes(p: ReturnType<typeof montarPedidoDeLegenda>) {
  const content = p.messages[0]!.content as Array<{ type: string; text?: string }>;
  return { texto: content.find((c) => c.type === "text")!.text!, arquivos: content.filter((c) => c.type === "file").length };
}

describe("montarPedidoDeLegenda", () => {
  it("põe a instrução da rede no system e as imagens como partes de arquivo", () => {
    const p = montarPedidoDeLegenda({ network: "instagram", formats: ["feed"], idea: "Promo coca 2L", instrucao: "Tom divertido.", imagens: img(2), videosIgnorados: 0 });
    expect(p.system).toContain("Tom divertido.");
    expect(p.system).toContain("Instagram");
    expect(p.system).toContain("No máximo 2200 caracteres");
    const { texto, arquivos } = partes(p);
    expect(arquivos).toBe(2);
    expect(texto).toContain("Promo coca 2L");
    expect(texto).toContain("as 2 imagens anexadas");
  });

  it(`lê no máximo ${MAXIMO_DE_IMAGENS_LIDAS} imagens`, () => {
    const p = montarPedidoDeLegenda({ network: "facebook", formats: [], idea: "", instrucao: "x", imagens: img(7), videosIgnorados: 0 });
    expect(partes(p).arquivos).toBe(MAXIMO_DE_IMAGENS_LIDAS);
  });

  it("sem ideia, baseia-se nas imagens; vídeo ignorado é dito ao modelo", () => {
    const { texto } = partes(montarPedidoDeLegenda({ network: "whatsapp", formats: ["group_message"], idea: "   ", instrucao: "x", imagens: img(1), videosIgnorados: 2 }));
    expect(texto).toContain("Não há ideia escrita");
    expect(texto).toContain("2 vídeos");
    expect(texto).not.toContain("<ideia>");
  });

  it("sem imagem, escreve a partir da ideia", () => {
    const { texto, arquivos } = partes(montarPedidoDeLegenda({ network: "instagram", formats: [], idea: "Inauguração sábado", instrucao: "x", imagens: [], videosIgnorados: 0 }));
    expect(arquivos).toBe(0);
    expect(texto).toContain("Não há imagem");
  });
});

describe("limiteDaLegenda", () => {
  it("usa o menor teto entre os formatos marcados, ignorando Stories", () => {
    expect(limiteDaLegenda("instagram", ["feed", "story"])).toBe(2200);
    expect(limiteDaLegenda("facebook", ["feed"])).toBe(4000);
    expect(limiteDaLegenda("whatsapp", ["group_message"])).toBe(4000);
  });
  it("só Stories ou sem formato: o menor teto da rede", () => {
    expect(limiteDaLegenda("instagram", ["story"])).toBe(2200);
    expect(limiteDaLegenda("instagram", [])).toBe(2200);
  });
});

describe("limparLegenda", () => {
  it("tira cerca de código, rótulo e aspas", () => {
    expect(limparLegenda("```\nOi gente!\n```", 100)).toBe("Oi gente!");
    expect(limparLegenda("Legenda: Bora!", 100)).toBe("Bora!");
    expect(limparLegenda("“Chegou a promo”", 100)).toBe("Chegou a promo");
  });
  it("corta no limite sem quebrar palavra", () => {
    const t = limparLegenda("palavra ".repeat(50), 100);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.endsWith("palavra")).toBe(true);
  });
});

describe("contratos", () => {
  it("exige imagem ou ideia", () => {
    expect(sugerirLegendaSchema.safeParse({ network: "instagram" }).success).toBe(false);
    expect(sugerirLegendaSchema.safeParse({ network: "instagram", idea: "x" }).success).toBe(true);
    expect(sugerirLegendaSchema.safeParse({ network: "instagram", media_paths: ["a"] }).success).toBe(true);
  });
  it("recusa rede fora do vocabulário e mais de 4 imagens", () => {
    expect(sugerirLegendaSchema.safeParse({ network: "tiktok", idea: "x" }).success).toBe(false);
    expect(sugerirLegendaSchema.safeParse({ network: "instagram", media_paths: ["a", "b", "c", "d", "e"] }).success).toBe(false);
  });
  it("instrução: rede válida e até 4000", () => {
    expect(salvarInstrucaoSchema.safeParse({ network: "facebook", instructions: "" }).success).toBe(true);
    expect(salvarInstrucaoSchema.safeParse({ network: "facebook", instructions: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("instrucoesEmVigor", () => {
  it("devolve as três redes, com o padrão onde não há linha", () => {
    const r = instrucoesEmVigor([{ network: "instagram", instructions: "Minha regra", updated_at: "2026-10-06T00:00:00Z" }]);
    expect(r.map((x) => x.network)).toEqual(["instagram", "facebook", "whatsapp"]);
    expect(r[0]).toMatchObject({ instructions: "Minha regra", personalizada: true });
    expect(r[1]).toMatchObject({ instructions: INSTRUCAO_PADRAO.facebook, personalizada: false });
  });
});
