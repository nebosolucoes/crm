import { describe, expect, it, vi } from "vitest";

import { LlmBudgetExceededError, LlmNotConfiguredError } from "@/lib/agent-engine/edge/llm/run-model-call";

import { INSTRUCAO_PADRAO } from "./instrucoes";
import { sugerirLegendaSchema } from "./montar-pedido";
import { ErroDaLegenda, sugerirLegenda, type DepsDaLegenda } from "./sugerir";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const caminho = (org: string) => `${org}/publications/nova/abc.jpg`;

function deps(over: Partial<DepsDaLegenda> = {}): DepsDaLegenda {
  return {
    lerPrompt: async () => null,
    baixar: async () => ({ data: new Uint8Array([1]), mime: "image/jpeg" }),
    chamarModelo: async (_pedido, conferir) => {
      await conferir({ provider: "anthropic", model: "claude" });
      return { text: "Legenda pronta ✨", model: "claude", callId: "call-1" };
    },
    enxerga: async () => true,
    ...over,
  };
}
const PROMPT = "33333333-3333-4333-8333-333333333333";
const pedido = (p: Record<string, unknown>) =>
  sugerirLegendaSchema.parse({ ...(p.prompt_id ? {} : { network: "instagram" }), destinos: [{ network: "instagram", format: "feed" }], ...p });

describe("sugerirLegenda", () => {
  it("devolve a legenda com o que foi lido", async () => {
    const r = await sugerirLegenda(ORG, pedido({ media_paths: [caminho(ORG)], ignored_videos: 1 }), deps());
    expect(r).toMatchObject({ caption: "Legenda pronta ✨", origem: { tipo: "padrao", network: "instagram" }, used_images: 1, ignored_videos: 1, llm_call_id: "call-1" });
  });

  it("com prompt, usa o texto dele e diz o nome; com rede, o padrão", async () => {
    const chamar = vi.fn<DepsDaLegenda["chamarModelo"]>(async () => ({ text: "ok", model: "m", callId: null }));
    const lerPrompt = vi.fn(async (id: string) => (id === PROMPT ? { name: "Padaria", instructions: "Regra da marca" } : null));
    const r = await sugerirLegenda(ORG, pedido({ prompt_id: PROMPT, idea: "x" }), deps({ chamarModelo: chamar, lerPrompt }));
    expect(lerPrompt).toHaveBeenCalledWith(PROMPT);
    expect(chamar.mock.calls[0]![0].system).toContain("Regra da marca");
    expect(r.origem).toEqual({ tipo: "prompt", prompt_id: PROMPT, nome: "Padaria" });
    await sugerirLegenda(ORG, pedido({ idea: "x" }), deps({ chamarModelo: chamar, lerPrompt }));
    expect(chamar.mock.calls[1]![0].system).toContain(INSTRUCAO_PADRAO.instagram.split("\n")[0]!);
  });

  it("prompt apagado entre a tela e o clique vira 404 nomeado, sem chamar a IA", async () => {
    const chamar = vi.fn(deps().chamarModelo);
    await expect(sugerirLegenda(ORG, pedido({ prompt_id: PROMPT, idea: "x" }), deps({ chamarModelo: chamar }))).rejects.toMatchObject({ codigo: "prompt_not_found", status: 404 });
    expect(chamar).not.toHaveBeenCalled();
  });

  it("recusa arquivo de outra organização sem baixar nada", async () => {
    const baixar = vi.fn(deps().baixar);
    await expect(sugerirLegenda(ORG, pedido({ media_paths: [caminho(OUTRA)] }), deps({ baixar }))).rejects.toMatchObject({ codigo: "media_not_found", status: 404 });
    expect(baixar).not.toHaveBeenCalled();
  });

  it("recusa vídeo", async () => {
    await expect(
      sugerirLegenda(ORG, pedido({ media_paths: [caminho(ORG)] }), deps({ baixar: async () => ({ data: new Uint8Array([1]), mime: "video/mp4" }) })),
    ).rejects.toMatchObject({ codigo: "media_not_image" });
  });

  it("modelo sem visão vira motivo, e a chamada não sai", async () => {
    const enviado = vi.fn();
    const chamar: DepsDaLegenda["chamarModelo"] = async (_p, conferir) => {
      await conferir({ provider: "openrouter", model: "texto-only" });
      enviado();
      return { text: "inventada", model: "texto-only", callId: null };
    };
    await expect(sugerirLegenda(ORG, pedido({ media_paths: [caminho(ORG)] }), deps({ chamarModelo: chamar, enxerga: async () => false }))).rejects.toMatchObject({
      codigo: "modelo_sem_visao",
      status: 422,
    });
    expect(enviado).not.toHaveBeenCalled();
  });

  it("sem imagem, modelo sem visão serve", async () => {
    const r = await sugerirLegenda(ORG, pedido({ idea: "Promo" }), deps({ enxerga: async () => false }));
    expect(r.caption).toBe("Legenda pronta ✨");
  });

  it("traduz IA não configurada, orçamento e falha do provedor", async () => {
    const lanca = (e: unknown): DepsDaLegenda["chamarModelo"] => async () => {
      throw e;
    };
    await expect(sugerirLegenda(ORG, pedido({ idea: "x" }), deps({ chamarModelo: lanca(new LlmNotConfiguredError()) }))).rejects.toMatchObject({ codigo: "ia_nao_configurada" });
    await expect(sugerirLegenda(ORG, pedido({ idea: "x" }), deps({ chamarModelo: lanca(new LlmBudgetExceededError()) }))).rejects.toMatchObject({ codigo: "orcamento_esgotado" });
    const err = await sugerirLegenda(ORG, pedido({ idea: "x" }), deps({ chamarModelo: lanca(Object.assign(new Error("Unauthorized"), { status: 401 })) })).catch((e) => e);
    expect(err).toBeInstanceOf(ErroDaLegenda);
    expect(err).toMatchObject({ codigo: "provedor_falhou", status: 502, detalhe: "credencial_recusada" });
  });

  it("resposta em branco não vira legenda vazia", async () => {
    await expect(sugerirLegenda(ORG, pedido({ idea: "x" }), deps({ chamarModelo: async () => ({ text: "  ", model: "m", callId: null }) }))).rejects.toMatchObject({ codigo: "resposta_vazia" });
  });
});
