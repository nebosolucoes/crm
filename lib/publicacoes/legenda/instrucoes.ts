import { z } from "zod";

import { REDES_DA_PUBLICACAO, type RedeDaPublicacao } from "@/lib/publicacoes/schema";

/**
 * A INSTRUÇÃO DE LEGENDA DE CADA REDE — o "prompt prévio" do Sugerir legenda.
 *
 * A organização escreve uma por rede em Publicações › Instruções de legenda
 * (tabela `publication_caption_instructions`, migration 0286). Sem linha, vale o
 * padrão daqui — e é por isso que o padrão mora no código e não numa linha
 * semeada no banco: quem nunca personalizou ganha a melhoria quando o produto
 * melhora, e "Restaurar padrão" é só apagar a linha.
 */

/** Teto da instrução — o mesmo do CHECK `publication_caption_instructions_instructions_check`. */
export const MAXIMO_DA_INSTRUCAO = 4000;

export const INSTRUCAO_PADRAO: Record<RedeDaPublicacao, string> = {
  instagram: [
    "Escreva uma legenda para Instagram.",
    "Abra com uma frase que prenda a atenção na primeira linha.",
    "Tom próximo e positivo; use emojis com moderação (no máximo 3).",
    "Feche com uma chamada para ação clara (comentar, salvar, chamar no Direct, clicar no link da bio).",
    "No fim, até 5 hashtags relevantes ao assunto.",
  ].join("\n"),
  facebook: [
    "Escreva uma legenda para Facebook.",
    "Tom de conversa, frases curtas, como quem fala com a comunidade.",
    "Pode ser um pouco mais explicativa que no Instagram.",
    "Feche com uma chamada para ação clara.",
    "No máximo 2 hashtags, ou nenhuma.",
  ].join("\n"),
  whatsapp: [
    "Escreva uma mensagem para grupos de WhatsApp.",
    "Curta e direta: de 2 a 5 linhas.",
    "Use a formatação do WhatsApp quando ajudar: *negrito* para o destaque, _itálico_ com moderação.",
    "Sem hashtags.",
    "Feche com o próximo passo (responder, chamar no privado, acessar o link).",
  ].join("\n"),
};

export const redeDaInstrucaoSchema = z.enum(REDES_DA_PUBLICACAO);

/** PUT de Instruções de legenda. Texto vazio = apagar e voltar ao padrão. */
export const salvarInstrucaoSchema = z
  .object({
    network: redeDaInstrucaoSchema,
    instructions: z.string().max(MAXIMO_DA_INSTRUCAO),
  })
  .strict();
export type SalvarInstrucao = z.infer<typeof salvarInstrucaoSchema>;

/** O que a tela recebe: as três redes, sempre, com a instrução em vigor. */
export interface InstrucaoDaRede {
  network: RedeDaPublicacao;
  instructions: string;
  /** `false` = a org não escreveu nada e vale o padrão do produto. */
  personalizada: boolean;
  padrao: string;
  updated_at: string | null;
}

/** Junta o que está no banco com o padrão, nas três redes e na ordem do vocabulário. */
export function instrucoesEmVigor(
  linhas: ReadonlyArray<{ network: string; instructions: string; updated_at: string | null }>,
): InstrucaoDaRede[] {
  const porRede = new Map(linhas.map((l) => [l.network, l]));
  return REDES_DA_PUBLICACAO.map((network) => {
    const linha = porRede.get(network);
    const texto = linha?.instructions.trim() ?? "";
    return {
      network,
      instructions: texto || INSTRUCAO_PADRAO[network],
      personalizada: texto.length > 0,
      padrao: INSTRUCAO_PADRAO[network],
      updated_at: linha?.updated_at ?? null,
    };
  });
}
