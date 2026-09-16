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

export const grupoDoWhatsappSchema = z.object({
  channel_session_id: z.string().uuid(),
  external_group_id: z.string().trim().regex(/@g\.us$/),
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

export const criarAgendamentoDeGrupoSchema = z.object({
  channel_session_id: z.string().uuid(),
  group_id: z.string().uuid(),
  title: z.string().trim().min(1).max(160).nullable().optional(),
  body: z.string().trim().min(1).max(4000),
  status: z.enum(STATUS_DO_AGENDAMENTO_DE_GRUPO).default("draft"),
  starts_at: z.string().datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(80).default("America/Sao_Paulo"),
  recurrence_kind: z.enum(RECORRENCIAS_DE_GRUPO).default("none"),
  recurrence_config: z.record(z.string(), z.unknown()).default({}),
  repeat_until: z.string().datetime({ offset: true }).nullable().optional(),
  max_runs: z.number().int().positive().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const alterarAgendamentoDeGrupoSchema = criarAgendamentoDeGrupoSchema
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
