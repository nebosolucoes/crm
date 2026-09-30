/**
 * As constantes de política do módulo Publicações — num lugar só, com o
 * porquê de cada número. Quem for mudar um deles muda aqui e o teste que o
 * cobre acusa se a intenção escrita deixou de valer.
 */

/**
 * Quanto tempo depois do horário uma ocorrência ainda sai. Passou disso, ela
 * vira `skipped/missed_window` e a Central avisa. Sem esta tolerância, uma VPS
 * que ficou 3 horas fora dispararia TUDO que perdeu ao voltar — foi o defeito
 * medido no Disparo (resume recolocava `next_run_at = starts_at`).
 */
export const TOLERANCIA_DE_ATRASO_MS = 30 * 60 * 1000;

/** Motivo gravado em `publication_occurrences.skipped_reason` quando a janela passou. */
export const MOTIVO_JANELA_PERDIDA = "missed_window";

/** Quantos dias à frente a recorrência materializa ocorrências. */
export const HORIZONTE_DE_RECORRENCIA_DIAS = 90;

/** Teto de ocorrências pendentes por publicação recorrente (o horizonte que vier primeiro). */
export const TETO_DE_OCORRENCIAS_PENDENTES = 100;

/**
 * Tentativas por unidade de execução e o espaçamento entre elas. Só erro
 * TRANSITÓRIO tenta de novo; o permanente falha na primeira e avisa.
 */
export const MAXIMO_DE_TENTATIVAS = 3;
export const ESPERA_ENTRE_TENTATIVAS_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000];

/** Lease do claim: mais que isso sem terminar é reconciliação, nunca reenvio. */
export const LEASE_DA_EXECUCAO_S = 300;

/** Orçamento de tempo de um tick do worker; o que sobrar fica para o próximo minuto. */
export const ORCAMENTO_DO_TICK_MS = 45_000;

/**
 * Anti-banimento no WhatsApp (CLAUDE.md): entre ARQUIVOS do mesmo grupo,
 * 1,2 s + jitter de até 0,8 s (herdado do Disparo); entre GRUPOS da mesma
 * conexão, 5 s ("campanha 1 msg/5 s"), que o Disparo nunca aplicou.
 */
export const PAUSA_ENTRE_ARQUIVOS_MS = 1200;
export const JITTER_ENTRE_ARQUIVOS_MS = 800;
export const PAUSA_ENTRE_GRUPOS_MS = 5000;

/** Entre posts da mesma conta social no mesmo tick (25 posts/h por conta no provedor). */
export const PAUSA_ENTRE_POSTS_SOCIAIS_MS = 3000;

/** Validade da URL assinada que o provedor recebe para baixar a mídia. */
export const VALIDADE_DA_URL_ASSINADA_S = 600;

/** Quanto tempo uma execução `sending` sem notícia espera antes da reconciliação. */
export const SILENCIO_ANTES_DE_RECONCILIAR_MS = 10 * 60 * 1000;

/** Espera pela resposta do provedor social numa publicação síncrona. */
export const TIMEOUT_DA_PUBLICACAO_SOCIAL_MS = 60_000;

/**
 * Espera que o worker dá a uma ocorrência antes de julgar. Um instante é
 * "vencido" quando `scheduled_at <= agora`.
 */
export function ocorrenciaVenceu(scheduledAt: string | Date, agora: Date): boolean {
  return new Date(scheduledAt).getTime() <= agora.getTime();
}

/** A ocorrência perdeu a janela: venceu há mais que a tolerância. */
export function ocorrenciaPerdeuAJanela(scheduledAt: string | Date, agora: Date): boolean {
  return agora.getTime() - new Date(scheduledAt).getTime() > TOLERANCIA_DE_ATRASO_MS;
}

/** Quando tentar de novo, dada a tentativa que acabou de falhar (1-based). */
export function proximaTentativaEm(tentativa: number, agora: Date, retryAfterMs?: number | null): Date | null {
  if (tentativa >= MAXIMO_DE_TENTATIVAS) return null;
  const base = ESPERA_ENTRE_TENTATIVAS_MS[tentativa - 1] ?? ESPERA_ENTRE_TENTATIVAS_MS.at(-1)!;
  const espera = retryAfterMs && retryAfterMs > 0 ? Math.max(base, retryAfterMs) : base;
  return new Date(agora.getTime() + espera);
}
