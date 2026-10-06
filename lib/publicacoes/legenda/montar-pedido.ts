import type { ModelMessage } from "ai";
import { z } from "zod";

import { LIMITES_POR_DESTINO } from "@/lib/publicacoes/regras-por-destino";
import { FORMATOS_DA_PUBLICACAO, FORMATOS_POR_REDE, type FormatoDaPublicacao, type RedeDaPublicacao } from "@/lib/publicacoes/schema";
import { redeDaInstrucaoSchema } from "@/lib/publicacoes/legenda/instrucoes";

/**
 * O PEDIDO DE LEGENDA — puro: entra rede, formatos, ideia, instrução e imagens;
 * sai `system` + `messages` para `runModelCall`. Nada de rede, banco ou chave
 * aqui, para que cada regra do pedido seja testável sem provedor.
 */

/** Quantas imagens a IA lê. Mais que isso encarece e quase nunca muda a legenda. */
export const MAXIMO_DE_IMAGENS_LIDAS = 4;

/** Teto da ideia — o mesmo do campo Legenda da tela. */
export const MAXIMO_DA_IDEIA = 4000;

/** Corpo do POST /api/v1/publicacoes/legenda/sugerir. */
export const sugerirLegendaSchema = z
  .object({
    network: redeDaInstrucaoSchema,
    formats: z.array(z.enum(FORMATOS_DA_PUBLICACAO)).max(FORMATOS_DA_PUBLICACAO.length).default([]),
    idea: z.string().max(MAXIMO_DA_IDEIA).default(""),
    media_paths: z.array(z.string().min(1).max(512)).max(MAXIMO_DE_IMAGENS_LIDAS).default([]),
    /** Quantos vídeos a tela deixou de fora — só para a resposta dizer. */
    ignored_videos: z.number().int().min(0).max(100).default(0),
  })
  .strict()
  .refine((v) => v.idea.trim().length > 0 || v.media_paths.length > 0, {
    message: "Anexe uma imagem ou escreva uma ideia na legenda.",
    path: ["media_paths"],
  });
export type SugerirLegenda = z.infer<typeof sugerirLegendaSchema>;

export interface ImagemDoPedido {
  data: Uint8Array;
  mediaType: string;
}

/**
 * O maior tamanho de legenda que serve a TODOS os formatos marcados desta rede.
 * Stories (`legendaMax: 0`) não mostram legenda e não restringem; sem formato
 * informado, vale o menor teto da rede.
 */
export function limiteDaLegenda(network: RedeDaPublicacao, formats: readonly FormatoDaPublicacao[]): number {
  const daRede = LIMITES_POR_DESTINO[network] as Record<string, { legendaMax: number }>;
  const validos = formats.filter((f) => FORMATOS_POR_REDE[network].includes(f));
  const considerados = (validos.length > 0 ? validos : FORMATOS_POR_REDE[network])
    .map((f) => daRede[f]?.legendaMax ?? 0)
    .filter((n) => n > 0);
  return considerados.length > 0 ? Math.min(...considerados) : Math.min(...Object.values(daRede).map((l) => l.legendaMax).filter((n) => n > 0));
}

const NOME_DA_REDE: Record<RedeDaPublicacao, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "grupos de WhatsApp" };

const ROTULO_DO_FORMATO: Record<FormatoDaPublicacao, string> = {
  feed: "Feed",
  story: "Stories",
  reel: "Reels",
  group_message: "mensagem em grupos",
};

export function montarPedidoDeLegenda(p: {
  network: RedeDaPublicacao;
  formats: readonly FormatoDaPublicacao[];
  idea: string;
  instrucao: string;
  imagens: readonly ImagemDoPedido[];
  videosIgnorados: number;
}): { system: string; messages: ModelMessage[]; limite: number } {
  const limite = limiteDaLegenda(p.network, p.formats);
  const formatos = p.formats.filter((f) => FORMATOS_POR_REDE[p.network].includes(f));
  const imagens = p.imagens.slice(0, MAXIMO_DE_IMAGENS_LIDAS);
  const ideia = p.idea.trim();

  const system = [
    `Você escreve legendas de publicações para ${NOME_DA_REDE[p.network]} em nome de uma empresa.`,
    "Siga à risca a instrução da empresa abaixo. Ela vale mais que qualquer preferência sua de estilo.",
    "",
    "<instrucao_da_empresa>",
    p.instrucao.trim(),
    "</instrucao_da_empresa>",
    "",
    "Regras fixas:",
    `- No máximo ${limite} caracteres.`,
    "- Escreva no idioma da ideia; sem ideia, em português do Brasil.",
    "- Não invente preço, data, endereço, desconto ou dado que não esteja na ideia ou visível nas imagens.",
    "- Responda SÓ com a legenda pronta para publicar: sem título, sem aspas, sem explicação, sem opções alternativas.",
  ].join("\n");

  const partes: string[] = [];
  if (formatos.length > 0) partes.push(`Onde vai sair: ${formatos.map((f) => ROTULO_DO_FORMATO[f]).join(", ")}.`);
  partes.push(
    imagens.length > 0
      ? `Estude ${imagens.length === 1 ? "a imagem anexada" : `as ${imagens.length} imagens anexadas, na ordem do post`} e escreva a legenda a partir do que elas mostram.`
      : "Não há imagem; escreva a partir da ideia.",
  );
  if (p.videosIgnorados > 0) partes.push(`O post também tem ${p.videosIgnorados === 1 ? "um vídeo" : `${p.videosIgnorados} vídeos`} que você não consegue ver; não descreva o conteúdo deles.`);
  partes.push(ideia ? `Ideia de quem está postando (use como base, pode reescrever):\n<ideia>\n${ideia}\n</ideia>` : "Não há ideia escrita; baseie-se nas imagens.");

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: partes.join("\n\n") },
        ...imagens.map((img) => ({ type: "file" as const, data: img.data, mediaType: img.mediaType })),
      ],
    },
  ];
  return { system, messages, limite };
}

/**
 * Limpa o que o modelo devolveu: modelo obediente responde só a legenda, mas
 * não é raro vir embrulhada em cerca de código, entre aspas ou com um rótulo
 * "Legenda:" na frente. Corta no limite sem quebrar no meio de uma palavra.
 */
export function limparLegenda(bruta: string, limite: number): string {
  let t = bruta.trim();
  t = t.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  t = t.replace(/^(legenda|caption|mensagem)\s*:\s*/i, "").trim();
  if (t.length >= 2 && /^["“'«]/.test(t) && /["”'»]$/.test(t)) t = t.slice(1, -1).trim();
  if (t.length > limite) {
    const corte = t.slice(0, limite);
    const ultimoEspaco = corte.search(/\s\S*$/);
    t = (ultimoEspaco > limite * 0.8 ? corte.slice(0, ultimoEspaco) : corte).trimEnd();
  }
  return t;
}
