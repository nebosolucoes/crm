/**
 * Rótulos e cores das telas de Publicações — um lugar só, para a Lista, o
 * Calendário, o Sheet e o Histórico dizerem a mesma coisa. As frases passam
 * por `t()` em quem renderiza (o teste de i18n cobra `es` para cada uma).
 *
 * Cores por tokens do tema (classes Tailwind), nunca hex — o branding da
 * instalação troca o acento e o escuro segue junto.
 */
import type { FormatoDaPublicacao, RedeDaPublicacao, StatusDaExecucao, StatusDaOcorrencia } from "@/lib/publicacoes/schema";

export const ROTULO_DA_REDE: Record<RedeDaPublicacao, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
};

export const ROTULO_DO_FORMATO: Record<FormatoDaPublicacao, string> = {
  feed: "Feed",
  story: "Stories",
  reel: "Reels",
  group_message: "Grupos",
};

/** O ponto colorido de cada rede — tokens semânticos, não a cor da marca alheia. */
export const PONTO_DA_REDE: Record<RedeDaPublicacao, string> = {
  instagram: "bg-fuchsia-500",
  facebook: "bg-sky-500",
  whatsapp: "bg-emerald-500",
};

export const ROTULO_DO_STATUS_DA_OCORRENCIA: Record<StatusDaOcorrencia, string> = {
  pending: "Agendada",
  processing: "Publicando",
  done: "Publicada",
  partial: "Parcial",
  failed: "Falhou",
  skipped: "Não saiu",
  cancelled: "Cancelada",
};

export const VARIANTE_DO_STATUS_DA_OCORRENCIA: Record<StatusDaOcorrencia, "default" | "neutral" | "success" | "warning" | "error" | "info"> = {
  pending: "info",
  processing: "default",
  done: "success",
  partial: "warning",
  failed: "error",
  skipped: "warning",
  cancelled: "neutral",
};

export const ROTULO_DO_STATUS_DA_EXECUCAO: Record<StatusDaExecucao, string> = {
  pending: "Na fila",
  sending: "Enviando",
  sent: "Publicado",
  failed: "Falhou",
  skipped: "Pulado",
  cancelled: "Cancelado",
};

export const VARIANTE_DO_STATUS_DA_EXECUCAO: Record<StatusDaExecucao, "default" | "neutral" | "success" | "warning" | "error" | "info"> = {
  pending: "info",
  sending: "default",
  sent: "success",
  failed: "error",
  skipped: "warning",
  cancelled: "neutral",
};

/** O motivo de uma ocorrência pulada, em frase de gente. */
export const ROTULO_DO_MOTIVO_DE_PULO: Record<string, string> = {
  missed_window: "O horário passou com o sistema parado e a publicação não saiu atrasada.",
  feature_not_entitled: "O plano da organização não inclui Publicações.",
  publication_unavailable: "A publicação foi cancelada ou excluída antes do horário.",
  no_targets: "A publicação chegou ao horário sem nenhum destino.",
  no_units: "Não havia grupos ou arquivos para publicar.",
  all_executions_skipped: "Nenhum destino pôde ser publicado.",
};

/** Os códigos de erro mais comuns, em frase de gente (o resto mostra a mensagem crua). */
export const ROTULO_DO_ERRO: Record<string, string> = {
  partial_send: "Parte dos arquivos saiu e o envio parou; confira no grupo antes de reenviar.",
  worker_timeout: "O envio ficou preso e foi encerrado sem reenvio automático.",
  channel_not_working: "A conexão não está ativa.",
  channel_starting: "A conexão ainda estava iniciando.",
  channel_unavailable: "A conexão foi removida.",
  group_inactive: "O grupo está desativado no cadastro.",
  group_missing: "O grupo saiu da lista da publicação.",
  account_disconnected: "A conta foi desconectada no provedor.",
  account_not_enabled_for_posting: "A conexão não tem permissão para publicar.",
  duplicate_content: "O mesmo conteúdo já foi publicado nesta conta nas últimas 24 horas.",
  rate_limited: "Limite de publicações atingido; o sistema tentou de novo.",
  provider_timeout: "O provedor demorou demais para responder.",
  media_unreadable: "A mídia não pôde ser lida para envio.",
  storage_sign_failed: "A mídia não pôde ser preparada para envio.",
  publishing_not_supported: "Esta conexão não publica conteúdo agendado.",
  provider_not_configured: "O provedor de redes sociais não está configurado nesta instalação.",
};
