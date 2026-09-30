import { describe, expect, it } from "vitest";

import { indiceValido, slidesDosDestinos } from "./slides";

const d = (network: "instagram" | "facebook" | "whatsapp", format: "feed" | "story" | "reel" | "group_message", conta = "c1", group_ids?: string[]) => ({ network, format, channel_session_id: conta, group_ids, settings: {} });

describe("slides da prévia", () => {
  it("um slide por destino, na ordem Instagram → Facebook → WhatsApp e Feed → Stories → Reels, com o rótulo da tela", () => {
    const s = slidesDosDestinos([d("whatsapp", "group_message", "wa", ["g1", "g2"]), d("facebook", "story"), d("instagram", "reel"), d("instagram", "feed")]);
    expect(s.map((x) => x.rotulo)).toEqual(["Instagram · Feed", "Instagram · Reels", "Facebook · Stories", "WhatsApp · Grupos"]);
    expect(s[3]!.grupoIds).toEqual(["g1", "g2"]);
  });

  it("o slide atual sobrevive à mudança da lista; se sumiu, volta ao primeiro válido", () => {
    const antes = slidesDosDestinos([d("instagram", "feed"), d("facebook", "feed")]);
    expect(indiceValido(1, antes, "facebook/feed/c1")).toBe(1);
    const depois = slidesDosDestinos([d("instagram", "feed")]);
    expect(indiceValido(1, depois, "facebook/feed/c1")).toBe(0);
    expect(indiceValido(5, [], null)).toBe(0);
  });
});
