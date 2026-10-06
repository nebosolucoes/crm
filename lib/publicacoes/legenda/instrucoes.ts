import { z } from "zod";

import type { RedeDaPublicacao } from "@/lib/publicacoes/schema";

/**
 * OS PROMPTS DE LEGENDA — o jeito de escrever da marca, que o Sugerir legenda
 * manda à IA.
 *
 * O prompt é da MARCA, não da rede (migration 0286): tem nome, e se liga às
 * CONTAS que o usam — o Instagram e o Facebook da mesma empresa podem dividir
 * um prompt, e dois perfis de Instagram de empresas diferentes têm cada um o
 * seu. Uma conta pertence a no máximo um prompt.
 *
 * Conta sem prompt usa o padrão do produto para a rede dela, que mora aqui e
 * não numa linha semeada no banco: quem nunca personalizou ganha a melhoria
 * quando o produto melhora.
 */

export const MAXIMO_DA_INSTRUCAO = 4000;
export const MAXIMO_DO_NOME = 120;

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

const uuid = z.string().uuid();

export const criarPromptSchema = z
  .object({
    name: z.string().trim().min(1).max(MAXIMO_DO_NOME),
    instructions: z.string().trim().min(1).max(MAXIMO_DA_INSTRUCAO),
    channel_session_ids: z.array(uuid).max(200).default([]),
  })
  .strict();
export type CriarPrompt = z.infer<typeof criarPromptSchema>;

export const alterarPromptSchema = z
  .object({
    name: z.string().trim().min(1).max(MAXIMO_DO_NOME).optional(),
    instructions: z.string().trim().min(1).max(MAXIMO_DA_INSTRUCAO).optional(),
    channel_session_ids: z.array(uuid).max(200).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });
export type AlterarPrompt = z.infer<typeof alterarPromptSchema>;

/** Um prompt como a tela o recebe. */
export interface PromptDeLegenda {
  id: string;
  name: string;
  instructions: string;
  channel_session_ids: string[];
  updated_at: string;
}

/** GET /prompts-de-legenda — os prompts da organização e os padrões por rede. */
export interface PromptsDaOrganizacao {
  prompts: PromptDeLegenda[];
  padroes: Record<RedeDaPublicacao, string>;
}

/**
 * Uma escolha possível no Agendar: um prompt da organização, ou o padrão de
 * uma rede (para as contas sem prompt). `destinos` são os destinos marcados
 * que esta escolha cobre — é deles que sai o limite de caracteres.
 */
export type OpcaoDePrompt =
  | { tipo: "prompt"; chave: string; prompt_id: string; nome: string; redes: RedeDaPublicacao[]; contas: string[]; destinos: Array<{ network: RedeDaPublicacao; format: string }> }
  | { tipo: "padrao"; chave: string; network: RedeDaPublicacao; nome: string; redes: RedeDaPublicacao[]; contas: string[]; destinos: Array<{ network: RedeDaPublicacao; format: string }> };

/**
 * Quais prompts estão em jogo nas contas marcadas — a regra do Agendar.
 *
 * Cada conta marcada leva ao prompt dela; conta sem prompt leva ao padrão da
 * sua rede. Contas que dão no mesmo prompt viram UMA opção. Uma opção só:
 * gera direto; mais de uma: a tela pergunta qual usar. A ordem segue a dos
 * destinos marcados, para a pergunta listar na ordem em que a pessoa marcou.
 */
export function opcoesDePrompt(
  destinos: ReadonlyArray<{ network: RedeDaPublicacao; format: string; channel_session_id: string }>,
  prompts: ReadonlyArray<Pick<PromptDeLegenda, "id" | "name" | "channel_session_ids">>,
): OpcaoDePrompt[] {
  const promptDaConta = new Map<string, Pick<PromptDeLegenda, "id" | "name">>();
  for (const p of prompts) for (const conta of p.channel_session_ids) promptDaConta.set(conta, p);
  const opcoes = new Map<string, OpcaoDePrompt>();
  for (const d of destinos) {
    const prompt = promptDaConta.get(d.channel_session_id);
    const chave = prompt ? `prompt:${prompt.id}` : `padrao:${d.network}`;
    let o = opcoes.get(chave);
    if (!o) {
      o = prompt
        ? { tipo: "prompt", chave, prompt_id: prompt.id, nome: prompt.name, redes: [], contas: [], destinos: [] }
        : { tipo: "padrao", chave, network: d.network, nome: "", redes: [], contas: [], destinos: [] };
      opcoes.set(chave, o);
    }
    if (!o.redes.includes(d.network)) o.redes.push(d.network);
    if (!o.contas.includes(d.channel_session_id)) o.contas.push(d.channel_session_id);
    o.destinos.push({ network: d.network, format: d.format });
  }
  return [...opcoes.values()];
}

