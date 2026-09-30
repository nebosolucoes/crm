/**
 * Como cada rede ENQUADRA uma mídia — a parte da prévia que precisa ser fiel,
 * porque é o que a pessoa vai conferir contra o resultado.
 *
 * - Feed do Instagram: a foto sai na proporção em que foi subida, dentro do
 *   intervalo 4:5 (retrato) a 1.91:1 (paisagem). Fora dele a rede CORTA para
 *   o limite mais próximo. Num carrossel, a primeira foto dita a proporção.
 * - Feed do Facebook: uma foto sozinha aparece inteira, na proporção dela; só
 *   os extremos são cortados (a rede limita a altura). Duas ou mais viram grade.
 * - Stories e Reels: tela 9:16. O que não é 9:16 aparece INTEIRO, com faixas
 *   pretas em cima e embaixo (ou dos lados) — nunca com zoom.
 *
 * Sem dimensão conhecida (vídeo sem metadados, mídia antiga), assume-se o
 * padrão da rede: quadrado no Feed, tela cheia nos Stories.
 */

export const LIMITES_DO_FEED: Record<"instagram" | "facebook", { min: number; max: number }> = {
  instagram: { min: 4 / 5, max: 1.91 },
  facebook: { min: 1 / 2, max: 1.91 },
};

/** Proporção (largura/altura) do quadro do Feed para uma mídia w×h. */
export function proporcaoDoFeed(rede: "instagram" | "facebook", width: number | null | undefined, height: number | null | undefined): number {
  if (!width || !height || width <= 0 || height <= 0) return 1;
  const { min, max } = LIMITES_DO_FEED[rede];
  return Math.min(max, Math.max(min, width / height));
}

/** Diz se a rede vai cortar a mídia (proporção fora do intervalo do Feed). */
export function feedCorta(rede: "instagram" | "facebook", width: number | null | undefined, height: number | null | undefined): boolean {
  if (!width || !height || width <= 0 || height <= 0) return false;
  const { min, max } = LIMITES_DO_FEED[rede];
  const r = width / height;
  return r < min - 1e-6 || r > max + 1e-6;
}

/**
 * Num carrossel do Instagram todas as fotos saem no quadro da PRIMEIRA: a
 * que tem outra proporção é cortada, mesmo estando dentro do limite.
 */
export function carrosselCorta(rede: "instagram" | "facebook", midias: Array<{ width?: number | null; height?: number | null }>): boolean {
  if (rede !== "instagram" || midias.length < 2) return false;
  const primeira = midias[0]!;
  if (!primeira.width || !primeira.height) return false;
  const quadro = proporcaoDoFeed(rede, primeira.width, primeira.height);
  return midias.slice(1).some((m) => m.width && m.height && Math.abs(m.width / m.height - quadro) > 0.01);
}
