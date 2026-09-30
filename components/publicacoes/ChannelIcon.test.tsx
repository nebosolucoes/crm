import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CHANNEL_ICON_COMBINATIONS, CHANNEL_ICON_STATES, ChannelIcon, INACTIVE_COLOR, formatoParaChannelFormat } from "./ChannelIcon";

const html = (props: Parameters<typeof ChannelIcon>[0]) => renderToStaticMarkup(createElement(ChannelIcon, props));

describe("ChannelIcon — um tratamento por formato, três estados", () => {
  it("existem as 8 combinações pedidas, com o nome completo como rótulo", () => {
    expect(CHANNEL_ICON_COMBINATIONS.map((c) => c.name)).toEqual([
      "Instagram Feed",
      "Instagram Stories",
      "Instagram Reels",
      "Facebook Feed",
      "Facebook Stories",
      "Facebook Reels",
      "WhatsApp",
      "WhatsApp Status",
    ]);
    for (const c of CHANNEL_ICON_COMBINATIONS) {
      for (const state of CHANNEL_ICON_STATES) {
        const s = html({ channel: c.channel, format: c.format, state });
        expect(s).toContain(`aria-label="${c.name}"`);
        expect(s).toContain('role="img"');
        expect(s).toContain('viewBox="0 0 40 40"');
      }
    }
  });

  it("Feed é círculo cheio com logo branco; Stories/Status é anel segmentado com logo na cor; Reels tem claquete, play e selo", () => {
    const feed = html({ channel: "facebook", format: "feed" });
    expect(feed).toContain('r="20" fill="#1877F2"');
    expect(feed).toContain('fill="#FFFFFF" transform="translate(10 10)');
    expect(feed).not.toContain("stroke-dasharray");

    const stories = html({ channel: "facebook", format: "stories" });
    expect(stories).toContain('fill="none" stroke="#1877F2"');
    expect(stories).toMatch(/stroke-dasharray="10\.1\d+ 4"/);
    expect(stories).toContain('rotate(-90 20 20)');
    expect(stories).toContain('fill="#1877F2" transform="translate(10 10)');

    const status = html({ channel: "whatsapp", format: "status" });
    expect(status).toMatch(/stroke-dasharray="10\.1\d+ 4"/);
    expect(status).toContain('stroke="#25D366"');

    const reels = html({ channel: "instagram", format: "reels" });
    expect(reels).toContain('rx="4"'); // a claquete
    expect(reels).toContain("M17.5 19.2L24.5 23L17.5 26.8Z"); // o play
    expect(reels).toContain('r="7"'); // o selo (≈35%)
    expect(reels).toContain('stroke="#FFFFFF" stroke-width="1.5"');
  });

  it("Instagram ativo usa o gradiente da marca com id ÚNICO por instância; inativo e desativado viram #C4C4C4 sem gradiente", () => {
    const dois = renderToStaticMarkup(
      createElement("div", null, createElement(ChannelIcon, { channel: "instagram", format: "feed" }), createElement(ChannelIcon, { channel: "instagram", format: "stories" })),
    );
    const ids = [...dois.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(dois).toContain(`url(#${id})`);
    expect(dois).toContain('stop-color="#FEDA75"');
    expect(dois).toContain('stop-color="#4F5BD5"');

    const inativo = html({ channel: "instagram", format: "feed", state: "inactive" });
    expect(inativo).not.toContain("linearGradient");
    expect(inativo).toContain(`fill="${INACTIVE_COLOR}"`);
    expect(inativo).not.toContain("opacity-50");

    const desativado = html({ channel: "instagram", format: "reels", state: "disabled" });
    expect(desativado).toContain(`fill="${INACTIVE_COLOR}"`);
    expect(desativado).toContain("opacity-50");
    expect(desativado).toContain("cursor-not-allowed");
  });

  it("tamanho padrão 36px, hover com scale, e `decorative` esconde do leitor de tela", () => {
    const s = html({ channel: "whatsapp", format: "feed" });
    expect(s).toContain('width="36" height="36"');
    expect(s).toContain("hover:scale-105");
    expect(s).toContain("duration-150");
    const d = html({ channel: "whatsapp", format: "feed", decorative: true, size: 26 });
    expect(d).toContain('aria-hidden="true"');
    expect(d).not.toContain('role="img"');
    expect(d).toContain('width="26"');
  });

  it("mapeia o formato do domínio para o vocabulário do ícone (grupos do WhatsApp = feed)", () => {
    expect(formatoParaChannelFormat("feed")).toBe("feed");
    expect(formatoParaChannelFormat("story")).toBe("stories");
    expect(formatoParaChannelFormat("reel")).toBe("reels");
    expect(formatoParaChannelFormat("group_message")).toBe("feed");
  });
});
