/**
 * Enquadra uma IMAGEM no formato que a rede exige, sem distorcer nem cortar
 * a original: a imagem inteira, na proporção dela, centrada; as faixas que
 * sobram são pintadas com a COR DA BORDA vizinha da imagem — a de cima na
 * faixa de cima, a de baixo na de baixo (ou esquerda/direita, no Feed) —, com
 * degradê entre elas. É o que o aplicativo do Instagram faz ao postar uma foto
 * fora do formato: a faixa encosta na foto com a mesma cor e parece que a
 * imagem continua. (Pedido do dono em 01/10/2026; a primeira versão, com a
 * própria foto desfocada e escurecida no fundo, não tinha essa continuidade.)
 *
 * Por que existe, por formato:
 *  - Story: a API espera 1080 × 1920. Uma foto 2:3 enviada como está sai
 *    ESTICADA — medido em 01/10/2026 com 2045 × 3000. O app da rede não estica
 *    porque, ao postar pelo celular, ele mesmo põe a foto num quadro 9:16.
 *  - Feed: o Instagram aceita 4:5 a 1.91:1 e CORTA o que passa disso; num
 *    carrossel, todas as fotos saem no quadro da primeira. O Facebook mostra a
 *    foto sozinha inteira entre 1:2 e 1.91:1. Fora disso, aqui ela é encaixada
 *    no quadro mais próximo em vez de cortada.
 *
 * Não mexe em: imagem que já tem a proporção do quadro (±2%), vídeo, GIF. Se
 * o `sharp` não carregar (binário ausente na plataforma), devolve `null` e a
 * imagem segue como está: um corte da rede é pior que um enquadramento, mas
 * não sair nada é pior ainda.
 */
import type SharpDoModulo from "sharp";

export const LARGURA_DO_STORY = 1080;
export const ALTURA_DO_STORY = 1920;
const LARGURA_DO_FEED = 1080;
const TOLERANCIA = 0.02;
/** Quanto da borda entra na média da cor (2% do lado, no mínimo 2 px). */
const FRACAO_DA_BORDA = 0.02;

/** O intervalo de proporção (largura/altura) que cada rede mostra no Feed sem cortar. */
export const LIMITES_DO_FEED: Record<"instagram" | "facebook", { min: number; max: number }> = {
  instagram: { min: 4 / 5, max: 1.91 },
  facebook: { min: 1 / 2, max: 1.91 },
};

export interface Quadro {
  largura: number;
  altura: number;
}

export interface ImagemEnquadrada {
  bytes: Buffer;
  mime: "image/jpeg";
  /** Dimensões da original e do quadro, para o log e o teste. */
  original: { width: number; height: number };
  quadro: Quadro;
  /** As cores das duas faixas (borda de cima/baixo, ou esquerda/direita), em `rgb(...)`. */
  cores: [string, string];
}

/** A função `sharp(...)` — o default do módulo (ESM e CJS expõem de jeitos diferentes). */
type Sharp = typeof SharpDoModulo;

let sharpCarregado: Promise<Sharp | null> | null = null;
function carregarSharp(): Promise<Sharp | null> {
  sharpCarregado ??= import("sharp").then(
    (m) => ((m as { default?: Sharp }).default ?? (m as unknown as Sharp)),
    () => null,
  );
  return sharpCarregado;
}

const QUADRO_DO_STORY: Quadro = { largura: LARGURA_DO_STORY, altura: ALTURA_DO_STORY };

function mesmaProporcao(width: number, height: number, quadro: Quadro): boolean {
  if (width <= 0 || height <= 0) return false;
  const alvo = quadro.largura / quadro.altura;
  return Math.abs(width / height - alvo) / alvo <= TOLERANCIA;
}

/** A proporção está a ±2% de 9:16? Então a rede mostra a imagem como ela é. */
export function jaEhStory(width: number, height: number): boolean {
  return mesmaProporcao(width, height, QUADRO_DO_STORY);
}

/** O quadro do Feed para uma foto w×h: a proporção dela, presa ao intervalo da rede. */
export function quadroDoFeed(rede: "instagram" | "facebook", width: number, height: number): Quadro {
  const { min, max } = LIMITES_DO_FEED[rede];
  const r = width > 0 && height > 0 ? Math.min(max, Math.max(min, width / height)) : 1;
  return { largura: LARGURA_DO_FEED, altura: Math.round(LARGURA_DO_FEED / r) };
}

function ehImagemEstatica(mime: string): boolean {
  const tipo = mime.toLowerCase();
  return tipo.startsWith("image/") && tipo !== "image/gif";
}

/** Largura e altura já com a orientação EXIF aplicada (foto "deitada" no arquivo). */
export async function medirImagem(bytes: ArrayBuffer | Buffer, mime: string): Promise<{ width: number; height: number } | null> {
  if (!ehImagemEstatica(mime)) return null;
  const sharp = await carregarSharp();
  if (!sharp) return null;
  const m = await sharp(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).rotate().metadata();
  const girada = (m.orientation ?? 1) >= 5;
  const w = girada ? m.height : m.width;
  const h = girada ? m.width : m.height;
  return w && h ? { width: w, height: h } : null;
}

/**
 * Devolve a imagem encaixada no quadro pedido, ou `null` quando não há o que
 * fazer (já tem a proporção do quadro, não é imagem estática, ou o `sharp`
 * não está disponível).
 */
export async function enquadrarImagem(bytes: ArrayBuffer | Buffer, mime: string, quadro: Quadro): Promise<ImagemEnquadrada | null> {
  if (!ehImagemEstatica(mime)) return null;
  const sharp = await carregarSharp();
  if (!sharp) return null;
  const entrada = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const girada = await sharp(entrada).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = girada.info;
  if (!width || !height || mesmaProporcao(width, height, quadro)) return null;

  // A frente: a imagem inteira, sem transparência (PNG com alfa iria vazar o fundo).
  const frente = await sharp(girada.data)
    .flatten({ background: "#ffffff" })
    .resize(quadro.largura, quadro.altura, { fit: "inside", withoutEnlargement: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fw = frente.info.width;
  const fh = frente.info.height;
  const left = Math.round((quadro.largura - fw) / 2);
  const top = Math.round((quadro.altura - fh) / 2);
  // Faixas em cima e embaixo (foto mais alta que larga demais para o quadro) ou nas laterais.
  const vertical = fw >= quadro.largura - 1;
  const borda = (lado: number) => Math.max(2, Math.round(lado * FRACAO_DA_BORDA));
  // Média na mão sobre a faixa da borda: o `stats()` do sharp mede a imagem de
  // ENTRADA e ignora o `extract` — deu a média da foto inteira (medido no teste).
  const corDe = (regiao: { left: number; top: number; width: number; height: number }): Cor => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = regiao.top; y < regiao.top + regiao.height; y++) {
      for (let x = regiao.left; x < regiao.left + regiao.width; x++) {
        const o = (y * fw + x) * 3;
        r += frente.data[o]!;
        g += frente.data[o + 1]!;
        b += frente.data[o + 2]!;
      }
    }
    const n = Math.max(1, regiao.width * regiao.height);
    return [r / n, g / n, b / n];
  };
  const [corA, corB] = vertical
    ? [corDe({ left: 0, top: 0, width: fw, height: borda(fh) }), corDe({ left: 0, top: fh - borda(fh), width: fw, height: borda(fh) })]
    : [corDe({ left: 0, top: 0, width: borda(fw), height: fh }), corDe({ left: fw - borda(fw), top: 0, width: borda(fw), height: fh })];
  const fundo = fundoEmDegrade(quadro, vertical, corA, corB, vertical ? top : left, vertical ? top + fh : left + fw);
  const saida = await sharp(fundo, { raw: { width: quadro.largura, height: quadro.altura, channels: 3 } })
    .composite([{ input: frente.data, raw: { width: fw, height: fh, channels: 3 }, left, top }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  return { bytes: saida, mime: "image/jpeg", original: { width, height }, quadro, cores: [rgb(corA), rgb(corB)] };
}

type Cor = readonly [number, number, number];
const rgb = (c: Cor) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

/**
 * O fundo em pixels crus (RGB): a cor A até onde a foto começa, a cor B a
 * partir de onde ela termina, e o degradê entre as duas no trecho que a foto
 * cobre (escondido atrás dela — só garante que não há emenda dura).
 */
function fundoEmDegrade(quadro: Quadro, vertical: boolean, a: Cor, b: Cor, inicio: number, fim: number): Buffer {
  const { largura, altura } = quadro;
  const buf = Buffer.alloc(largura * altura * 3);
  const total = vertical ? altura : largura;
  const linha = new Uint8Array(total * 3);
  for (let i = 0; i < total; i++) {
    const t = i <= inicio ? 0 : i >= fim ? 1 : (i - inicio) / Math.max(1, fim - inicio);
    linha[i * 3] = Math.round(a[0] + (b[0] - a[0]) * t);
    linha[i * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * t);
    linha[i * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
  }
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = vertical ? y : x;
      const o = (y * largura + x) * 3;
      buf[o] = linha[i * 3]!;
      buf[o + 1] = linha[i * 3 + 1]!;
      buf[o + 2] = linha[i * 3 + 2]!;
    }
  }
  return buf;
}

/** O caso do Story: quadro 1080 × 1920. */
export function enquadrarImagemDeStory(bytes: ArrayBuffer | Buffer, mime: string): Promise<ImagemEnquadrada | null> {
  return enquadrarImagem(bytes, mime, QUADRO_DO_STORY);
}
