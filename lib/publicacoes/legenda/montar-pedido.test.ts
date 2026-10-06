import { describe, expect, it } from "vitest";

import { alterarPromptSchema, criarPromptSchema, opcoesDePrompt } from "./instrucoes";
import { limiteDaLegenda, limparLegenda, MAXIMO_DE_IMAGENS_LIDAS, montarPedidoDeLegenda, sugerirLegendaSchema } from "./montar-pedido";

const img = (n: number) => Array.from({ length: n }, () => ({ data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" }));
const IG_FEED = { network: "instagram", format: "feed" } as const;
const FB_FEED = { network: "facebook", format: "feed" } as const;
const WA = { network: "whatsapp", format: "group_message" } as const;

function partes(p: ReturnType<typeof montarPedidoDeLegenda>) {
  const content = p.messages[0]!.content as Array<{ type: string; text?: string }>;
  return { texto: content.find((c) => c.type === "text")!.text!, arquivos: content.filter((c) => c.type === "file").length };
}

describe("opcoesDePrompt — quais prompts as contas marcadas põem em jogo", () => {
  const IG_PADARIA = "00000000-0000-4000-8000-0000000000a1";
  const FB_PADARIA = "00000000-0000-4000-8000-0000000000a2";
  const IG_LOJA = "00000000-0000-4000-8000-0000000000b1";
  const WA_GRUPOS = "00000000-0000-4000-8000-0000000000c1";
  const prompts = [
    { id: "p-padaria", name: "Padaria", channel_session_ids: [IG_PADARIA, FB_PADARIA] },
    { id: "p-loja", name: "Loja", channel_session_ids: [IG_LOJA] },
  ];

  it("Instagram e Facebook da mesma empresa dão UMA opção, com os dois destinos", () => {
    const o = opcoesDePrompt(
      [
        { ...IG_FEED, channel_session_id: IG_PADARIA },
        { network: "instagram", format: "story", channel_session_id: IG_PADARIA },
        { ...FB_FEED, channel_session_id: FB_PADARIA },
      ],
      prompts,
    );
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ tipo: "prompt", prompt_id: "p-padaria", nome: "Padaria", redes: ["instagram", "facebook"], contas: [IG_PADARIA, FB_PADARIA] });
    expect(o[0]!.destinos).toHaveLength(3);
  });

  it("dois perfis de Instagram de empresas diferentes dão duas opções, na ordem marcada", () => {
    const o = opcoesDePrompt(
      [
        { ...IG_FEED, channel_session_id: IG_LOJA },
        { ...IG_FEED, channel_session_id: IG_PADARIA },
      ],
      prompts,
    );
    expect(o.map((x) => x.chave)).toEqual(["prompt:p-loja", "prompt:p-padaria"]);
  });

  it("conta sem prompt cai no padrão da rede dela, ao lado dos prompts", () => {
    const o = opcoesDePrompt(
      [
        { ...IG_FEED, channel_session_id: IG_PADARIA },
        { ...WA, channel_session_id: WA_GRUPOS },
      ],
      prompts,
    );
    expect(o.map((x) => x.chave)).toEqual(["prompt:p-padaria", "padrao:whatsapp"]);
    expect(o[1]).toMatchObject({ tipo: "padrao", network: "whatsapp", contas: [WA_GRUPOS] });
  });

  it("sem prompt nenhum: uma opção de padrão por rede", () => {
    expect(opcoesDePrompt([{ ...IG_FEED, channel_session_id: IG_LOJA }], []).map((x) => x.chave)).toEqual(["padrao:instagram"]);
    expect(opcoesDePrompt([], prompts)).toEqual([]);
  });
});

describe("montarPedidoDeLegenda", () => {
  it("põe a instrução no system e as imagens como partes de arquivo", () => {
    const p = montarPedidoDeLegenda({ destinos: [IG_FEED], idea: "Promo coca 2L", instrucao: "Tom divertido.", imagens: img(2), videosIgnorados: 0 });
    expect(p.system).toContain("Tom divertido.");
    expect(p.system).toContain("Instagram");
    expect(p.system).toContain("No máximo 2200 caracteres");
    expect(p.system).not.toContain("A MESMA legenda");
    const { texto, arquivos } = partes(p);
    expect(arquivos).toBe(2);
    expect(texto).toContain("Promo coca 2L");
    expect(texto).toContain("as 2 imagens anexadas");
    expect(texto).toContain("Instagram Feed");
  });

  it("prompt que cobre duas redes avisa que a legenda é a mesma nas duas", () => {
    const p = montarPedidoDeLegenda({ destinos: [IG_FEED, FB_FEED], idea: "x", instrucao: "y", imagens: [], videosIgnorados: 0 });
    expect(p.system).toContain("Instagram e Facebook");
    expect(p.system).toContain("A MESMA legenda");
  });

  it(`lê no máximo ${MAXIMO_DE_IMAGENS_LIDAS} imagens`, () => {
    expect(partes(montarPedidoDeLegenda({ destinos: [FB_FEED], idea: "", instrucao: "x", imagens: img(7), videosIgnorados: 0 })).arquivos).toBe(MAXIMO_DE_IMAGENS_LIDAS);
  });

  it("sem ideia, baseia-se nas imagens; vídeo ignorado é dito ao modelo", () => {
    const { texto } = partes(montarPedidoDeLegenda({ destinos: [WA], idea: "   ", instrucao: "x", imagens: img(1), videosIgnorados: 2 }));
    expect(texto).toContain("Não há ideia escrita");
    expect(texto).toContain("2 vídeos");
    expect(texto).not.toContain("<ideia>");
  });
});

describe("limiteDaLegenda", () => {
  it("o menor teto entre os destinos cobertos, ignorando Stories", () => {
    expect(limiteDaLegenda([IG_FEED, { network: "instagram", format: "story" }])).toBe(2200);
    expect(limiteDaLegenda([FB_FEED])).toBe(4000);
    expect(limiteDaLegenda([FB_FEED, IG_FEED])).toBe(2200);
    expect(limiteDaLegenda([WA])).toBe(4000);
  });
  it("só Stories: o menor teto da rede", () => {
    expect(limiteDaLegenda([{ network: "instagram", format: "story" }])).toBe(2200);
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
  const PROMPT = "00000000-0000-4000-8000-000000000001";
  it("prompt OU padrão de rede — nunca os dois, nunca nenhum", () => {
    expect(sugerirLegendaSchema.safeParse({ prompt_id: PROMPT, destinos: [IG_FEED], idea: "x" }).success).toBe(true);
    expect(sugerirLegendaSchema.safeParse({ network: "instagram", destinos: [IG_FEED], idea: "x" }).success).toBe(true);
    expect(sugerirLegendaSchema.safeParse({ prompt_id: PROMPT, network: "instagram", destinos: [IG_FEED], idea: "x" }).success).toBe(false);
    expect(sugerirLegendaSchema.safeParse({ destinos: [IG_FEED], idea: "x" }).success).toBe(false);
  });
  it("exige imagem ou ideia, ao menos um destino válido e no máximo 4 imagens", () => {
    expect(sugerirLegendaSchema.safeParse({ network: "instagram", destinos: [IG_FEED] }).success).toBe(false);
    expect(sugerirLegendaSchema.safeParse({ network: "instagram", destinos: [], idea: "x" }).success).toBe(false);
    expect(sugerirLegendaSchema.safeParse({ network: "instagram", destinos: [{ network: "whatsapp", format: "feed" }], idea: "x" }).success).toBe(false);
    expect(sugerirLegendaSchema.safeParse({ network: "instagram", destinos: [IG_FEED], media_paths: ["a", "b", "c", "d", "e"] }).success).toBe(false);
  });
  it("prompt: nome e texto obrigatórios; alterar exige algum campo", () => {
    expect(criarPromptSchema.safeParse({ name: "Padaria", instructions: "x" }).success).toBe(true);
    expect(criarPromptSchema.safeParse({ name: " ", instructions: "x" }).success).toBe(false);
    expect(criarPromptSchema.safeParse({ name: "P", instructions: "x".repeat(4001) }).success).toBe(false);
    expect(criarPromptSchema.safeParse({ name: "P", instructions: "x", channel_session_ids: ["nao-e-uuid"] }).success).toBe(false);
    expect(alterarPromptSchema.safeParse({}).success).toBe(false);
    expect(alterarPromptSchema.safeParse({ channel_session_ids: [] }).success).toBe(true);
  });
});
