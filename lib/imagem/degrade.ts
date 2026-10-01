/**
 * O degradê das faixas de uma imagem encaixada (Story, Feed) — a MESMA conta
 * no envio (`lib/channels/publicacao/enquadrar-story.ts`) e na prévia
 * (`components/publicacoes/previa/Aparelho.tsx`), para a prévia não mentir.
 *
 * Cada faixa começa, encostada na foto, com a cor exata da borda vizinha (a
 * emenda some) e termina, na beirada da tela, num tom deslocado da mesma cor:
 * mais claro quando ela é escura, mais escuro quando é clara. É o que faz o
 * degradê aparecer mesmo quando a borda de cima e a de baixo têm a mesma cor —
 * caso medido em 01/10/2026 num encarte marrom, que saiu com as faixas lisas.
 */
export type Rgb = readonly [number, number, number];

/** Quanto a ponta da faixa se afasta da cor da borda (0–1, mistura com branco ou preto). */
export const DESLOCAMENTO_DO_DEGRADE = 0.32;

/** Luminância percebida (0–255). */
export function luminancia(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** A cor da ponta da faixa (na beirada da tela) para uma cor de borda. */
export function pontaDoDegrade(c: Rgb, deslocamento = DESLOCAMENTO_DO_DEGRADE): Rgb {
  const alvo = luminancia(c) < 140 ? 255 : 0;
  return [c[0] + (alvo - c[0]) * deslocamento, c[1] + (alvo - c[1]) * deslocamento, c[2] + (alvo - c[2]) * deslocamento];
}

export function cssRgb(c: Rgb): string {
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
}

/** Interpolação linear entre duas cores (t de 0 a 1). */
export function misturar(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
