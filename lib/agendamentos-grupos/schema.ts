import { z } from "zod";

export const STATUS_DO_AGENDAMENTO_DE_GRUPO = [
  "draft",
  "scheduled",
  "paused",
  "cancelled",
  "completed",
] as const;

export const STATUS_DA_EXECUCAO_DE_GRUPO = [
  "pending",
  "sending",
  "sent",
  "failed",
  "cancelled",
  "skipped",
] as const;

export const RECORRENCIAS_DE_GRUPO = ["none", "daily", "weekly", "monthly", "custom"] as const;

export const TIPOS_DE_MIDIA_AGENDADA = ["image", "video", "audio", "document"] as const;

/**
 * Teto de arquivos por disparo. Cada arquivo vira UMA mensagem no grupo, e o
 * worker espaça os envios — trinta é folga para catálogo e material de
 * campanha sem virar rajada que o WhatsApp lê como spam. É constante, não
 * regra: quem precisar de mais muda aqui e no texto da tela.
 */
export const MAXIMO_DE_ARQUIVOS_POR_DISPARO = 30;

/** Teto de grupos num único disparo — cada grupo vira um agendamento próprio. */
export const MAXIMO_DE_GRUPOS_POR_DISPARO = 100;

export const midiaAgendadaSchema = z.object({
  kind: z.enum(TIPOS_DE_MIDIA_AGENDADA),
  storage_path: z.string().trim().min(1).max(500),
  mime: z.string().trim().min(1).max(160),
  size_bytes: z.number().int().positive(),
  filename: z.string().trim().min(1).max(255).nullable().optional(),
});

export type MidiaAgendada = z.infer<typeof midiaAgendadaSchema>;

/**
 * Duas chaves no jsonb, e as duas são escritas de propósito:
 *
 *  - `scheduled_media_items` é a lista — a fonte de verdade desde que um
 *    disparo aceita vários arquivos;
 *  - `scheduled_media` é o formato anterior (UM arquivo, só foto ou vídeo). Ele
 *    continua sendo gravado com o primeiro item compatível porque o `agent.sh`
 *    reverte a IMAGEM, nunca o banco: um código antigo lendo uma linha nova
 *    ainda encontra a mídia em vez de mandar só o texto.
 *
 * Na leitura a lista vence; sem lista, o formato antigo vira lista de um.
 */
const CHAVE_DA_MIDIA_AGENDADA = "scheduled_media";
const CHAVE_DAS_MIDIAS_AGENDADAS = "scheduled_media_items";
const CHAVE_DO_LOTE = "batch";

function objetoJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * O jsonb continua encapsulado aqui: API, worker e UI não conhecem a chave
 * interna. Isso evita transformar `metadata.scheduled_media` num contrato
 * espalhado — o anti-pattern de jsonb lock-in da doutrina do repositório.
 */
export function midiasAgendadasDoMetadata(metadata: unknown): MidiaAgendada[] {
  const objeto = objetoJson(metadata);
  const lista = z.array(midiaAgendadaSchema).safeParse(objeto[CHAVE_DAS_MIDIAS_AGENDADAS]);
  if (lista.success) return lista.data;
  const unica = midiaAgendadaSchema.safeParse(objeto[CHAVE_DA_MIDIA_AGENDADA]);
  return unica.success ? [unica.data] : [];
}

/** O primeiro arquivo, ou nada — o contrato de UM arquivo que a tela antiga lia. */
export function midiaAgendadaDoMetadata(metadata: unknown): MidiaAgendada | null {
  return midiasAgendadasDoMetadata(metadata)[0] ?? null;
}

export function metadataComMidiasAgendadas(
  metadata: unknown,
  medias: readonly MidiaAgendada[],
): Record<string, unknown> {
  const proximo = objetoJson(metadata);
  if (medias.length === 0) {
    delete proximo[CHAVE_DAS_MIDIAS_AGENDADAS];
    delete proximo[CHAVE_DA_MIDIA_AGENDADA];
    return proximo;
  }
  proximo[CHAVE_DAS_MIDIAS_AGENDADAS] = [...medias];
  // O formato antigo só conhecia foto e vídeo; um PDF ali seria recusado pelo
  // Zod de quem lê, e o disparo inteiro sairia sem anexo.
  const compativel = medias.find((m) => m.kind === "image" || m.kind === "video");
  if (compativel) proximo[CHAVE_DA_MIDIA_AGENDADA] = compativel;
  else delete proximo[CHAVE_DA_MIDIA_AGENDADA];
  return proximo;
}

export function metadataComMidiaAgendada(
  metadata: unknown,
  media: MidiaAgendada | null,
): Record<string, unknown> {
  return metadataComMidiasAgendadas(metadata, media ? [media] : []);
}

/**
 * O LOTE: um disparo criado para vários grupos vira N agendamentos, um por
 * grupo, e o que os liga é este carimbo. A tela usa para mostrar "1 de 5" e o
 * histórico para agrupar; o worker não o lê — cada linha é independente.
 */
export const loteDeDisparoSchema = z.object({
  id: z.string().uuid(),
  size: z.number().int().positive(),
  index: z.number().int().nonnegative(),
});

export type LoteDeDisparo = z.infer<typeof loteDeDisparoSchema>;

export function loteDoMetadata(metadata: unknown): LoteDeDisparo | null {
  const parsed = loteDeDisparoSchema.safeParse(objetoJson(metadata)[CHAVE_DO_LOTE]);
  return parsed.success ? parsed.data : null;
}

export function metadataComLote(
  metadata: unknown,
  lote: LoteDeDisparo | null,
): Record<string, unknown> {
  const proximo = objetoJson(metadata);
  if (lote) proximo[CHAVE_DO_LOTE] = lote;
  else delete proximo[CHAVE_DO_LOTE];
  return proximo;
}

export const grupoDoWhatsappSchema = z.object({
  channel_session_id: z.string().uuid(),
  external_group_id: z
    .string()
    .trim()
    .regex(/@g\.us$/),
  name: z.string().trim().min(1).max(160),
  is_active: z.boolean().optional(),
  last_seen_at: z.string().datetime({ offset: true }).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const alterarGrupoDoWhatsappSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.name !== undefined || v.is_active !== undefined || v.metadata !== undefined, {
    message: "Informe pelo menos um campo para alterar.",
  });

/**
 * O destino é UM grupo (`group_id`, o contrato original) OU vários
 * (`group_ids`). Com vários, a conexão de cada agendamento é a do PRÓPRIO
 * grupo — a tela pode misturar grupos de contas diferentes, e o
 * `channel_session_id` do corpo deixa de ser fonte.
 */
export const criarAgendamentoDeGrupoSchema = z.object({
  channel_session_id: z.string().uuid().optional(),
  group_id: z.string().uuid().optional(),
  group_ids: z.array(z.string().uuid()).min(1).max(MAXIMO_DE_GRUPOS_POR_DISPARO).optional(),
  title: z.string().trim().min(1).max(160).nullable().optional(),
  body: z.string().trim().min(1).max(4000),
  status: z.enum(STATUS_DO_AGENDAMENTO_DE_GRUPO).default("draft"),
  starts_at: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(80).default("America/Sao_Paulo"),
  recurrence_kind: z.enum(RECORRENCIAS_DE_GRUPO).default("none"),
  recurrence_config: z.record(z.string(), z.unknown()).default({}),
  repeat_until: z.string().datetime({ offset: true }).nullable().optional(),
  max_runs: z.number().int().positive().nullable().optional(),
  media: midiaAgendadaSchema.nullable().optional(),
  media_items: z.array(midiaAgendadaSchema).max(MAXIMO_DE_ARQUIVOS_POR_DISPARO).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CriarAgendamentoDeGrupo = z.infer<typeof criarAgendamentoDeGrupoSchema>;

/** Os grupos do pedido, na ordem, sem repetição — `group_ids` vence `group_id`. */
export function gruposDoPedido(
  input: Pick<CriarAgendamentoDeGrupo, "group_id" | "group_ids">,
): string[] {
  const lista = input.group_ids?.length ? input.group_ids : input.group_id ? [input.group_id] : [];
  return [...new Set(lista)];
}

/** Os arquivos do pedido — `media_items` vence `media`; `media: null` limpa. */
export function midiasDoPedido(
  input: Pick<CriarAgendamentoDeGrupo, "media" | "media_items">,
): MidiaAgendada[] | undefined {
  if (input.media_items !== undefined) return input.media_items;
  if (input.media === undefined) return undefined;
  return input.media ? [input.media] : [];
}

export const alterarAgendamentoDeGrupoSchema = criarAgendamentoDeGrupoSchema
  .omit({ group_ids: true })
  .partial()
  .extend({
    status: z.enum(STATUS_DO_AGENDAMENTO_DE_GRUPO).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Informe pelo menos um campo para alterar.",
  });

export const filtrosDeAgendamentosDeGrupoSchema = z.object({
  status: z.enum(STATUS_DO_AGENDAMENTO_DE_GRUPO).optional(),
  group_id: z.string().uuid().optional(),
  channel_session_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const filtrosDeExecucoesDeGrupoSchema = z.object({
  status: z.enum(STATUS_DA_EXECUCAO_DE_GRUPO).optional(),
  scheduled_message_id: z.string().uuid().optional(),
  group_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const cancelarAgendamentoDeGrupoSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export function proximaExecucaoInicial(input: {
  status: (typeof STATUS_DO_AGENDAMENTO_DE_GRUPO)[number];
  starts_at: string;
}): string | null {
  return input.status === "scheduled" ? input.starts_at : null;
}

function somaDias(data: Date, dias: number): Date {
  const proxima = new Date(data);
  proxima.setUTCDate(proxima.getUTCDate() + dias);
  return proxima;
}

function somaMeses(data: Date, meses: number): Date {
  const proxima = new Date(data);
  proxima.setUTCMonth(proxima.getUTCMonth() + meses);
  return proxima;
}

function numeroPositivo(config: Record<string, unknown>, chave: string): number | null {
  const valor = config[chave];
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : null;
}

export function proximaExecucaoRecorrente(input: {
  recurrence_kind: (typeof RECORRENCIAS_DE_GRUPO)[number];
  recurrence_config: Record<string, unknown>;
  scheduled_for: string;
  repeat_until: string | null;
  runs_count: number;
  max_runs: number | null;
}): string | null {
  if (input.max_runs !== null && input.runs_count >= input.max_runs) return null;
  if (input.recurrence_kind === "none") return null;

  const base = new Date(input.scheduled_for);
  if (Number.isNaN(base.getTime())) return null;

  let proxima: Date | null = null;
  if (input.recurrence_kind === "daily") {
    proxima = somaDias(base, numeroPositivo(input.recurrence_config, "interval") ?? 1);
  } else if (input.recurrence_kind === "weekly") {
    proxima = somaDias(base, 7 * (numeroPositivo(input.recurrence_config, "interval") ?? 1));
  } else if (input.recurrence_kind === "monthly") {
    proxima = somaMeses(base, numeroPositivo(input.recurrence_config, "interval") ?? 1);
  } else if (input.recurrence_kind === "custom") {
    const intervalMinutes = numeroPositivo(input.recurrence_config, "interval_minutes");
    const intervalDays = numeroPositivo(input.recurrence_config, "interval_days");
    if (intervalMinutes) proxima = new Date(base.getTime() + intervalMinutes * 60_000);
    else if (intervalDays) proxima = somaDias(base, intervalDays);
  }

  if (!proxima) return null;
  if (input.repeat_until && proxima.getTime() > new Date(input.repeat_until).getTime()) return null;
  return proxima.toISOString();
}
