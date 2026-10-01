import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ALTURA_DO_STORY, LARGURA_DO_STORY, enquadrarImagem, enquadrarImagemDeStory, jaEhStory, medirImagem, quadroDoFeed } from "./enquadrar-story";

/** Uma imagem de teste: metade de cima vermelha, metade de baixo azul. */
async function imagem(width: number, height: number): Promise<Buffer> {
  const metade = Math.floor(height / 2);
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 255 } } })
    .composite([{ input: await sharp({ create: { width, height: metade, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer(), left: 0, top: 0 }])
    .jpeg()
    .toBuffer();
}

async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

describe("Story — a original inteira num quadro 9:16, sem esticar", () => {
  it("imagem 2:3 (o caso medido, 2045 × 3000) vira 1080 × 1920 com a original inteira e proporcional no centro", async () => {
    const r = await enquadrarImagemDeStory(await imagem(2045, 3000), "image/jpeg");
    expect(r).not.toBeNull();
    const meta = await sharp(r!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([LARGURA_DO_STORY, ALTURA_DO_STORY]);
    expect(r!.original).toEqual({ width: 2045, height: 3000 });
    // A frente ocupa a largura toda (1080) e 1080 × 3000/2045 ≈ 1584 de altura,
    // centrada: começa em (1920 − 1584)/2 ≈ 168.
    const topoDaFrente = Math.round((ALTURA_DO_STORY - Math.round((LARGURA_DO_STORY * 3000) / 2045)) / 2);
    const [r1, , b1] = await pixel(r!.bytes, 540, topoDaFrente + 40);
    expect(r1).toBeGreaterThan(200); // vermelho original, não esticado para cima
    expect(b1).toBeLessThan(60);
    const [r2, , b2] = await pixel(r!.bytes, 540, ALTURA_DO_STORY - topoDaFrente - 40);
    expect(b2).toBeGreaterThan(200); // azul original
    expect(r2).toBeLessThan(60);
  });

  it("as faixas continuam a imagem: a de cima tem a cor da borda de cima (vermelho), a de baixo a da borda de baixo (azul)", async () => {
    const r = await enquadrarImagemDeStory(await imagem(2045, 3000), "image/jpeg");
    // Medido ENCOSTADO na foto: ali a faixa tem a cor exata da borda (na beirada da tela é o tom deslocado do degradê).
    const topo = Math.round((ALTURA_DO_STORY - Math.round((LARGURA_DO_STORY * 3000) / 2045)) / 2);
    const [rt, gt, bt] = await pixel(r!.bytes, 540, topo - 3);
    expect(rt).toBeGreaterThan(220);
    expect(gt).toBeLessThan(40);
    expect(bt).toBeLessThan(40);
    const [rb, , bb] = await pixel(r!.bytes, 540, ALTURA_DO_STORY - topo + 2);
    expect(bb).toBeGreaterThan(220);
    expect(rb).toBeLessThan(40);
    // Sem textura de foto: na mesma altura, o canto e o centro da faixa têm a mesma cor.
    const [rc] = await pixel(r!.bytes, 5, topo - 3);
    expect(Math.abs(rc - rt)).toBeLessThan(6);
    expect(r!.cores[0]).toMatch(/^rgb\(2[2-5]\d, \d{1,2}, \d{1,2}\)$/);
  });

  it("a faixa é um DEGRADÊ: encostada na foto tem a cor da borda; na beirada da tela, um tom deslocado dela", async () => {
    // Borda escura (marrom, como o encarte medido): a beirada clareia.
    const marrom = await sharp({ create: { width: 2045, height: 3000, channels: 3, background: { r: 92, g: 42, b: 24 } } }).jpeg().toBuffer();
    const r = await enquadrarImagemDeStory(marrom, "image/jpeg");
    const topoDaFrente = Math.round((ALTURA_DO_STORY - Math.round((LARGURA_DO_STORY * 3000) / 2045)) / 2);
    const [rPerto] = await pixel(r!.bytes, 540, topoDaFrente - 3);
    const [rBeirada] = await pixel(r!.bytes, 540, 2);
    expect(Math.abs(rPerto - 92)).toBeLessThan(10); // emenda: a cor da borda
    expect(rBeirada).toBeGreaterThan(rPerto + 30); // degradê visível até a beirada
    const [rFundo] = await pixel(r!.bytes, 540, ALTURA_DO_STORY - 3);
    expect(rFundo).toBeGreaterThan(rPerto + 30); // embaixo também
  });

  it("imagem que já é 9:16, GIF e vídeo não são tocados", async () => {
    expect(await enquadrarImagemDeStory(await imagem(1080, 1920), "image/jpeg")).toBeNull();
    expect(await enquadrarImagemDeStory(Buffer.from("x"), "image/gif")).toBeNull();
    expect(await enquadrarImagemDeStory(Buffer.from("x"), "video/mp4")).toBeNull();
  });

  it("jaEhStory aceita ±2% de 9:16", () => {
    expect(jaEhStory(1080, 1920)).toBe(true);
    expect(jaEhStory(1080, 1900)).toBe(true);
    expect(jaEhStory(1080, 1350)).toBe(false);
  });
});

describe("Feed — a foto inteira no quadro que a rede aceita, em vez do corte", () => {
  it("quadroDoFeed: Instagram prende a 4:5–1.91:1; Facebook a 1:2–1.91:1; dentro do limite fica a proporção da foto", () => {
    expect(quadroDoFeed("instagram", 2045, 3000)).toEqual({ largura: 1080, altura: 1350 }); // 2:3 → 4:5
    expect(quadroDoFeed("instagram", 1080, 1080)).toEqual({ largura: 1080, altura: 1080 });
    expect(quadroDoFeed("instagram", 3000, 1000)).toEqual({ largura: 1080, altura: 565 }); // 3:1 → 1.91:1
    expect(quadroDoFeed("facebook", 2045, 3000)).toEqual({ largura: 1080, altura: 1584 }); // dentro de 1:2, a própria
    expect(quadroDoFeed("facebook", 1000, 3000)).toEqual({ largura: 1080, altura: 2160 }); // 1:3 → 1:2
  });

  it("foto 2:3 no Feed do Instagram vira 1080 × 1350 com a foto inteira, sem corte, e as laterais na cor das bordas laterais", async () => {
    const quadro = quadroDoFeed("instagram", 2045, 3000);
    const r = await enquadrarImagem(await imagem(2045, 3000), "image/jpeg", quadro);
    const meta = await sharp(r!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    // A foto ocupa a altura toda (1350) e 1350 × 2045/3000 ≈ 920 de largura: o topo é o vermelho original.
    const [r1, , b1] = await pixel(r!.bytes, 540, 10);
    expect(r1).toBeGreaterThan(200);
    expect(b1).toBeLessThan(60);
    const [, , b2] = await pixel(r!.bytes, 540, 1340);
    expect(b2).toBeGreaterThan(200);
    // A borda esquerda da foto é meio vermelha, meio azul: a faixa lateral é a média — roxo.
    // Encostado na foto (que ocupa ~920 px no meio, a partir de x≈80).
    const [rl, gl, bl] = await pixel(r!.bytes, 76, 675);
    expect(rl).toBeGreaterThan(90);
    expect(bl).toBeGreaterThan(90);
    expect(gl).toBeLessThan(40);
  });

  it("PNG com transparência não vaza o fundo: o transparente vira branco", async () => {
    const png = await sharp({ create: { width: 600, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const r = await enquadrarImagemDeStory(png, "image/png");
    const [rt, gt, bt] = await pixel(r!.bytes, 540, 20);
    expect(Math.min(rt, gt, bt)).toBeGreaterThan(240);
  });

  it("foto que já cabe no quadro (carrossel com a mesma proporção da primeira) vai como está", async () => {
    expect(await enquadrarImagem(await imagem(1080, 1350), "image/jpeg", quadroDoFeed("instagram", 1080, 1350))).toBeNull();
  });

  it("medirImagem devolve a dimensão já com a orientação aplicada", async () => {
    expect(await medirImagem(await imagem(2045, 3000), "image/jpeg")).toEqual({ width: 2045, height: 3000 });
    expect(await medirImagem(Buffer.from("x"), "video/mp4")).toBeNull();
  });
});
