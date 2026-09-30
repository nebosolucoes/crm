/**
 * Exporta cada combinação do `ChannelIcon` (rede × formato) como SVG e PNG
 * (32, 64, 128 e 256 px) em `public/icons/channels/`.
 *
 *   pnpm icones:exportar                      # só o estado ativo (40 arquivos)
 *   pnpm icones:exportar --todos-os-estados   # ativo, inativo e desativado
 *
 * O SVG é o próprio componente renderizado com `renderToStaticMarkup`. O PNG
 * sai do Chromium do Playwright (já é dependência do repo) com fundo
 * transparente — não há rasterizador em Node aqui, e o navegador desenha o
 * gradiente e os traços exatamente como a tela.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { chromium } from "@playwright/test";

import { CHANNEL_ICON_COMBINATIONS, CHANNEL_ICON_STATES, ChannelIcon, type ChannelIconState } from "../components/publicacoes/ChannelIcon";

const TAMANHOS = [32, 64, 128, 256] as const;
const DESTINO = path.join(process.cwd(), "public", "icons", "channels");

async function main(): Promise<void> {
  const estados: readonly ChannelIconState[] = process.argv.includes("--todos-os-estados") ? CHANNEL_ICON_STATES : ["active"];
  mkdirSync(DESTINO, { recursive: true });
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
  let arquivos = 0;
  try {
    for (const c of CHANNEL_ICON_COMBINATIONS) {
      for (const state of estados) {
        const base = `${c.channel}-${c.format}-${state}`;
        // Arquivo .svg solto precisa do namespace; inline no HTML, não (ver o cabeçalho do componente).
        const svg = renderToStaticMarkup(createElement(ChannelIcon, { channel: c.channel, format: c.format, state, size: 40 })).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
        writeFileSync(path.join(DESTINO, `${base}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`, "utf8");
        arquivos += 1;
        for (const tamanho of TAMANHOS) {
          const svgNoTamanho = renderToStaticMarkup(createElement(ChannelIcon, { channel: c.channel, format: c.format, state, size: tamanho }));
          await pagina.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svgNoTamanho}</body></html>`);
          await pagina.locator("svg").screenshot({ path: path.join(DESTINO, `${base}-${tamanho}.png`), omitBackground: true });
          arquivos += 1;
        }
      }
    }
  } finally {
    await navegador.close();
  }
  process.stdout.write(`${arquivos} arquivos em ${path.relative(process.cwd(), DESTINO)}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
