/**
 * O que cabe em cada destino — regras PURAS, por rede e formato, sem provedor.
 *
 * ─── Por que existe e por que é neutro ──────────────────────────────────────
 *
 * Um Reel precisa de UM vídeo vertical; um Story sai UM arquivo por vez; o
 * Feed do Facebook não mistura foto com vídeo. Descobrir isso na hora da
 * execução é descobrir tarde — a oferta já deveria estar no ar. Então a tela
 * pré-checa (feedback imediato) e a API confere de novo (autoridade) com a
 * MESMA tabela, que fala só de rede, formato, contagem, tipo, tamanho, duração
 * e proporção. Nada aqui sabe quem entrega (`lint:channels`); as regras foram
 * lidas da documentação do provedor em 30/09/2026 e o adapter em
 * `lib/channels/` é quem traduz o pedido para o transporte.
 *
 * ─── O que a tela sabe e o que só o provedor sabe ───────────────────────────
 *
 * Largura, altura e duração chegam como DICA lida no navegador (podem faltar).
 * Regra que depende delas só reprova quando o dado existe; sem o dado, vira
 * aviso ("não deu para conferir a duração"). A recusa definitiva fica com o
 * provedor, e aparece no Histórico como erro permanente com o motivo.
 */
import type { FormatoDaPublicacao, RedeDaPublicacao, TipoDeMidiaDaPublicacao } from "./schema";
import { MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO, MAXIMO_DE_STORIES_POR_PUBLICACAO } from "./schema";

export interface MidiaParaRegras {
  kind: TipoDeMidiaDaPublicacao;
  mime: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
}

export interface PedidoDeValidacao {
  network: RedeDaPublicacao;
  format: FormatoDaPublicacao;
  body: string | null | undefined;
  media: MidiaParaRegras[];
  /** Só WhatsApp. */
  groupCount?: number;
}

export interface ProblemaDoDestino {
  /** Estável, para a API devolver em `details` e a tela traduzir. */
  codigo: string;
  /** Frase para gente, em pt-BR (a tela passa por `t()`). */
  mensagem: string;
  /** Índice do arquivo na lista da publicação, quando o problema é de um arquivo. */
  mediaIndex?: number;
}

export interface VereditoDoDestino {
  ok: boolean;
  erros: ProblemaDoDestino[];
  avisos: ProblemaDoDestino[];
}

const MB = 1024 * 1024;
const IMAGENS_SOCIAIS = new Set(["image/jpeg", "image/jpg", "image/png"]);
const IMAGENS_FACEBOOK = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif"]);
const VIDEOS_SOCIAIS = new Set(["video/mp4", "video/quicktime"]);

/** Limites por rede × formato, como a documentação do provedor os descreve. */
export const LIMITES_POR_DESTINO = {
  instagram: {
    feed: { minMidias: 1, maxMidias: 10, imagemMaxBytes: 8 * MB, videoMaxBytes: 50 * MB, legendaMax: 2200, proporcaoMin: 0.5625, proporcaoMax: 1.91 },
    story: { minMidias: 1, maxMidias: MAXIMO_DE_STORIES_POR_PUBLICACAO, imagemMaxBytes: 8 * MB, videoMaxBytes: 50 * MB, duracaoMinMs: 3000, duracaoMaxMs: 60_000, legendaMax: 0 },
    reel: { minMidias: 1, maxMidias: 1, videoMaxBytes: 50 * MB, duracaoMinMs: 3000, duracaoMaxMs: 90_000, legendaMax: 2200 },
  },
  facebook: {
    feed: { minMidias: 0, maxMidias: 10, imagemMaxBytes: 4 * MB, videoMaxBytes: 50 * MB, legendaMax: 4000 },
    story: { minMidias: 1, maxMidias: MAXIMO_DE_STORIES_POR_PUBLICACAO, imagemMaxBytes: 4 * MB, videoMaxBytes: 50 * MB, duracaoMinMs: 0, duracaoMaxMs: 120_000, legendaMax: 0 },
    reel: { minMidias: 1, maxMidias: 1, videoMaxBytes: 50 * MB, duracaoMinMs: 3000, duracaoMaxMs: 60_000, legendaMax: 4000 },
  },
  whatsapp: {
    group_message: { minMidias: 0, maxMidias: MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO, legendaMax: 4000 },
  },
} as const;

/**
 * Como o destino vira execuções: Stories saem UM arquivo por post (a ordem é
 * a da lista); o resto é um post com todos os arquivos.
 */
export function unidadesDoDestino(format: FormatoDaPublicacao): "uma" | "por_midia" {
  return format === "story" ? "por_midia" : "uma";
}

function proporcao(m: MidiaParaRegras): number | null {
  return m.width && m.height ? m.width / m.height : null;
}

function ehImagem(m: MidiaParaRegras): boolean {
  return m.kind === "image";
}
function ehVideo(m: MidiaParaRegras): boolean {
  return m.kind === "video";
}

/** Valida um destino contra o conteúdo. Puro: sem I/O, sem provedor. */
export function validarDestino(p: PedidoDeValidacao): VereditoDoDestino {
  const erros: ProblemaDoDestino[] = [];
  const avisos: ProblemaDoDestino[] = [];
  const legenda = (p.body ?? "").trim();
  const n = p.media.length;

  const erro = (codigo: string, mensagem: string, mediaIndex?: number) => {
    erros.push(mediaIndex === undefined ? { codigo, mensagem } : { codigo, mensagem, mediaIndex });
  };
  const aviso = (codigo: string, mensagem: string, mediaIndex?: number) => {
    avisos.push(mediaIndex === undefined ? { codigo, mensagem } : { codigo, mensagem, mediaIndex });
  };

  if (p.network === "whatsapp") {
    if (p.format !== "group_message") erro("formato_invalido", "O WhatsApp só envia mensagem para grupos.");
    if (!p.groupCount || p.groupCount < 1) erro("sem_grupos", "Escolha pelo menos um grupo do WhatsApp.");
    if (n === 0 && legenda.length === 0) erro("sem_conteudo", "Escreva uma mensagem ou anexe um arquivo.");
    if (n > MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO) erro("muitos_arquivos", `No máximo ${MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO} arquivos por envio.`);
    return { ok: erros.length === 0, erros, avisos };
  }

  // ── Redes sociais ────────────────────────────────────────────────────────
  const limites = LIMITES_POR_DESTINO[p.network][p.format as "feed" | "story" | "reel"];
  const imagensAceitas = p.network === "facebook" ? IMAGENS_FACEBOOK : IMAGENS_SOCIAIS;

  for (const [i, m] of p.media.entries()) {
    if (m.kind === "audio" || m.kind === "document") {
      erro("tipo_nao_aceito", "Áudio e documento não são publicados em redes sociais; só foto e vídeo.", i);
      continue;
    }
    if (ehImagem(m) && !imagensAceitas.has(m.mime.toLowerCase())) {
      erro("imagem_nao_aceita", p.network === "facebook" ? "Use foto JPEG, PNG ou GIF." : "Use foto JPEG ou PNG.", i);
    }
    if (ehVideo(m) && !VIDEOS_SOCIAIS.has(m.mime.toLowerCase())) {
      erro("video_nao_aceito", "Use vídeo MP4 ou MOV.", i);
    }
    if (ehImagem(m) && "imagemMaxBytes" in limites && m.size_bytes > limites.imagemMaxBytes) {
      // O provedor comprime foto grande no Instagram; no Facebook recusa.
      if (p.network === "instagram") aviso("imagem_grande", "Foto acima de 8 MB será comprimida ao publicar.", i);
      else erro("imagem_grande", "Foto acima de 4 MB não é aceita neste destino.", i);
    }
    if (ehVideo(m) && "videoMaxBytes" in limites && m.size_bytes > limites.videoMaxBytes) {
      erro("video_grande", "Vídeo acima de 50 MB não é aceito.", i);
    }
    if (ehVideo(m) && "duracaoMaxMs" in limites) {
      if (m.duration_ms == null) {
        aviso("duracao_desconhecida", "Não deu para conferir a duração do vídeo; o destino pode recusar ao publicar.", i);
      } else {
        if (m.duration_ms > limites.duracaoMaxMs) {
          erro("video_longo", `Vídeo com mais de ${Math.round(limites.duracaoMaxMs / 1000)} s não cabe neste formato.`, i);
        }
        if ("duracaoMinMs" in limites && limites.duracaoMinMs > 0 && m.duration_ms < limites.duracaoMinMs) {
          erro("video_curto", `Vídeo precisa ter pelo menos ${Math.round(limites.duracaoMinMs / 1000)} s.`, i);
        }
      }
    }
    const prop = proporcao(m);
    if (prop !== null) {
      if ((p.format === "story" || p.format === "reel") && (prop < 0.5 || prop > 0.6)) {
        aviso("proporcao_vertical", "Este formato é vertical (9:16); o arquivo pode sair com bordas ou cortado.", i);
      }
      if (p.network === "instagram" && p.format === "feed" && "proporcaoMin" in limites && (prop < limites.proporcaoMin || prop > limites.proporcaoMax)) {
        aviso("proporcao_feed", "Proporção fora de 4:5 a 1.91:1; o Instagram pode cortar a foto.", i);
      }
    }
  }

  if (n < limites.minMidias) {
    erro("sem_midia", p.format === "reel" ? "Reels precisa de um vídeo." : "Este formato precisa de pelo menos um arquivo.");
  }
  if (n > limites.maxMidias) {
    erro("muitas_midias", p.format === "story"
      ? `No máximo ${limites.maxMidias} Stories por publicação.`
      : p.format === "reel"
        ? "Reels aceita um único vídeo."
        : `No máximo ${limites.maxMidias} arquivos neste formato.`);
  }

  const imagens = p.media.filter(ehImagem).length;
  const videos = p.media.filter(ehVideo).length;

  if (p.format === "reel" && n > 0 && videos === 0) erro("reel_sem_video", "Reels precisa de um vídeo, não de uma foto.");
  if (p.format === "feed" && p.network === "facebook" && imagens > 0 && videos > 0) {
    erro("feed_misto", "O Facebook não mistura foto e vídeo na mesma publicação.");
  }
  if (p.format === "feed" && p.network === "facebook" && videos > 1) erro("muitos_videos", "O Facebook aceita um vídeo por publicação.");
  if (p.format === "feed" && p.network === "instagram" && n === 1 && videos === 1) {
    aviso("vira_reel", "No Instagram, um vídeo único no Feed é publicado como Reel.");
  }
  if (p.format === "feed" && n === 0 && legenda.length === 0) erro("sem_conteudo", "Escreva uma legenda ou anexe um arquivo.");
  if (limites.legendaMax > 0 && legenda.length > limites.legendaMax) {
    erro("legenda_longa", `A legenda passa de ${limites.legendaMax} caracteres para este destino.`);
  }
  if (limites.legendaMax === 0 && legenda.length > 0) {
    aviso("sem_legenda_em_story", "Stories não mostram legenda; o texto não sai neste destino.");
  }

  return { ok: erros.length === 0, erros, avisos };
}
