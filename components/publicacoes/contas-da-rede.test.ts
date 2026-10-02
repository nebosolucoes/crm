import { describe, expect, it } from "vitest";

import type { DestinoDaPublicacao } from "@/lib/publicacoes/schema";

import { aplicarContasNaRede, contasMarcadasDaRede } from "./contas-da-rede";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const W = "00000000-0000-4000-8000-0000000000ff";

const whatsapp: DestinoDaPublicacao = { network: "whatsapp", format: "group_message", channel_session_id: W, group_ids: [W], settings: {} };

describe("aplicarContasNaRede", () => {
  it("liga o formato novo em cada conta marcada, sem tocar outra rede", () => {
    const r = aplicarContasNaRede([whatsapp], "instagram", "feed", [A, B]);
    expect(r).toHaveLength(3);
    expect(r[0]).toBe(whatsapp);
    expect(r.slice(1).map((d) => `${d.format}/${d.channel_session_id}`)).toEqual([`feed/${A}`, `feed/${B}`]);
  });

  it("a conta nova recebe todos os formatos já ligados da rede, e o destino existente é preservado", () => {
    const feedA: DestinoDaPublicacao = { id: "x", network: "instagram", format: "feed", channel_session_id: A, settings: { caption_override: "oi" } };
    const storyA: DestinoDaPublicacao = { network: "instagram", format: "story", channel_session_id: A, settings: {} };
    const r = aplicarContasNaRede([feedA, storyA], "instagram", null, [A, B]);
    expect(r.map((d) => `${d.format}/${d.channel_session_id}`)).toEqual([`feed/${A}`, `feed/${B}`, `story/${A}`, `story/${B}`]);
    expect(r[0]).toBe(feedA);
    expect(r[1]?.settings).toEqual({ caption_override: "oi" });
  });

  it("desmarcar uma conta tira só os destinos dela; nenhuma conta tira a rede", () => {
    const base = aplicarContasNaRede([whatsapp], "facebook", "feed", [A, B]);
    expect(contasMarcadasDaRede(aplicarContasNaRede(base, "facebook", null, [B]), "facebook")).toEqual([B]);
    expect(aplicarContasNaRede(base, "facebook", null, [])).toEqual([whatsapp]);
  });
});
