/**
 * Vocabulário dos comentários na inbox (spec 22).
 *
 * `TIPOS_DE_CONVERSA` é espelhado no CHECK `conversations_kind_check`
 * (migration 0285) e vigiado por
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 *
 * - `direct`: mensagens — WhatsApp, Direct, Messenger. UMA por contato em cada
 *   conexão (`uniq_conversations_1to1_per_contact_session`).
 * - `comment`: UM comentário principal de post ou anúncio e as respostas dele.
 *   Várias por contato e conexão; a chave é o id do comentário raiz, guardado
 *   em `conversations.provider_conversation_id`.
 */
export const TIPOS_DE_CONVERSA = ["direct", "comment"] as const;
export type TipoDeConversa = (typeof TIPOS_DE_CONVERSA)[number];

export const CONVERSA_DIRECT: TipoDeConversa = "direct";
export const CONVERSA_COMENTARIO: TipoDeConversa = "comment";

/** Lê a coluna sem confiar nela: linha antiga ou leitura sem a coluna é Direct. */
export function tipoDeConversa(valor: unknown): TipoDeConversa {
  return valor === CONVERSA_COMENTARIO ? CONVERSA_COMENTARIO : CONVERSA_DIRECT;
}

/**
 * Por que um atendimento de comentário foi fechado. Vocabulário ABERTO (vive
 * só aqui, sem CHECK): é gravado no audit e na timeline, não numa coluna.
 */
export const MOTIVOS_DE_FECHAMENTO_DE_COMENTARIO = [
  "respondido_no_crm",
  "respondido_pelo_app",
  "sem_resposta_necessaria",
  "spam",
  "ocultado",
] as const;
export type MotivoDeFechamentoDeComentario = (typeof MOTIVOS_DE_FECHAMENTO_DE_COMENTARIO)[number];

/** Motivos que a PESSOA escolhe ao fechar sem responder (os outros são automáticos). */
export const MOTIVOS_DE_FECHAR_SEM_RESPOSTA = [
  "sem_resposta_necessaria",
  "spam",
  "ocultado",
] as const satisfies readonly MotivoDeFechamentoDeComentario[];

/** Prazo default do aviso de comentário sem resposta (decisão do dono, 30/09/2026). */
export const PRAZO_PADRAO_DE_COMENTARIO_SEM_RESPOSTA_HORAS = 4;
