import type { ModelMessage } from "ai";
import { z } from "zod";

import { LIMITES_POR_DESTINO } from "@/lib/publicacoes/regras-por-destino";
import { FORMATOS_DA_PUBLICACAO, FORMATOS_POR_REDE, REDES_DA_PUBLICACAO, type FormatoDaPublicacao, type RedeDaPublicacao } from "@/lib/publicacoes/schema";

/**
 * O PEDIDO DE LEGENDA — puro: entra rede, formatos, ideia, instrução e imagens;
 * sai `system` + `messages` para `runModelCall`. Nada de rede, banco ou chave
 * aqui, para que cada regra do pedido seja testável sem provedor.
 */

/** Quantas imagens a IA lê. Mais que isso encarece e quase nunca muda a legenda. */
export const MAXIMO_DE_IMAGENS_LIDAS = 4;

/** Teto da ideia — o mesmo do campo Legenda da tela. */
export const MAXIMO_DA_IDEIA = 4000;

const destinoDoPedidoSchema = z
  .object({ network: z.enum(REDES_DA_PUBLICACAO), format: z.enum(FORMATOS_DA_PUBLICACAO) })
  .refine((d) => FORMATOS_POR_REDE[d.network].includes(d.format), { message: "Formato fora da rede." });
export type DestinoDoPedido = z.infer<typeof destinoDoPedidoSchema>;

/**
 * Corpo do POST /api/v1/publicacoes/legenda/sugerir. A escolha é um prompt da
 * organização (`prompt_id`) OU o padrão de uma rede (`network`) — nunca os dois.
 * `destinos` são os destinos marcados que essa escolha cobre.
 */
export const sugerirLegendaSchema = z
  .object({
    prompt_id: z.string().uuid().optional(),
    network: z.enum(REDES_DA_PUBLICACAO).optional(),
    destinos: z.array(destinoDoPedidoSchema).min(1).max(60),
    idea: z.string().max(MAXIMO_DA_IDEIA).default(""),
    media_paths: z.array(z.string().min(1).max(512)).max(MAXIMO_DE_IMAGENS_LIDAS).default([]),
    /** Quantos vídeos a tela deixou de fora — só para a resposta dizer. */
    ignored_videos: z.number().int().min(0).max(100).default(0),
  })
  .strict()
  .refine((v) => (v.prompt_id ? 1 : 0) + (v.network ? 1 : 0) === 1, {
    message: "Escolha um prompt ou o padrão de uma rede.",
    path: ["prompt_id"],
  })
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
 * O maior tamanho de legenda que serve a TODOS os destinos cobertos. Stories
 * (`legendaMax: 0`) não mostram legenda e não restringem; só Stories, vale o
 * menor teto das redes envolvidas.
 */
export function limiteDaLegenda(destinos: readonly DestinoDoPedido[]): number {
  const teto = (network: RedeDaPublicacao, format: FormatoDaPublicacao) =>
    (LIMITES_POR_DESTINO[network] as Record<string, { legendaMax: number }>)[format]?.legendaMax ?? 0;
  const positivos = destinos.map((d) => teto(d.network, d.format)).filter((n) => n > 0);
  if (positivos.length > 0) return Math.min(...positivos);
  const redes = [...new Set(destinos.map((d) => d.network))];
  const daRede = redes.flatMap((r) => FORMATOS_POR_REDE[r].map((f) => teto(r, f))).filter((n) => n > 0);
  return daRede.length > 0 ? Math.min(...daRede) : 2200;
}

const NOME_DA_REDE: Record<RedeDaPublicacao, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "grupos de WhatsApp" };

const ROTULO_DO_FORMATO: Record<FormatoDaPublicacao, string> = {
  feed: "Feed",
  story: "Stories",
  reel: "Reels",
  group_message: "mensagem em grupos",
};

export function montarPedidoDeLegenda(p: {
  destinos: readonly DestinoDoPedido[];
  idea: string;
  instrucao: string;
  imagens: readonly ImagemDoPedido[];
  videosIgnorados: number;
}): { system: string; messages: ModelMessage[]; limite: number } {
  const limite = limiteDaLegenda(p.destinos);
  const redes = [...new Set(p.destinos.map((d) => d.network))];
  const onde = [...new Set(p.destinos.map((d) => (d.format === "group_message" ? NOME_DA_REDE.whatsapp : `${NOME_DA_REDE[d.network]} ${ROTULO_DO_FORMATO[d.format]}`)))];
  const imagens = p.imagens.slice(0, MAXIMO_DE_IMAGENS_LIDAS);
  const ideia = p.idea.trim();

  const system = [
    `Você escreve legendas de publicações para ${redes.map((r) => NOME_DA_REDE[r]).join(" e ")} em nome de uma empresa.`,
    redes.length > 1 ? "A MESMA legenda sai em todas essas redes: escreva algo que funcione em todas." : null,
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
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const partes: string[] = [];
  partes.push(`Onde vai sair: ${onde.join(", ")}.`);
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
