import { randomUUID } from "node:crypto";

import { getAdapter } from "@/lib/channels";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";
import type { ChannelProvider } from "@/lib/channels/types";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

import { proximaExecucaoRecorrente } from "./schema";
import type { RECORRENCIAS_DE_GRUPO } from "./schema";

const LIMITE_PADRAO = 50;
const TENTATIVAS_DE_CLAIM = 5;
const LIMITE_SENDING_PRESO_MS = 5 * 60_000;

type Recorrencia = (typeof RECORRENCIAS_DE_GRUPO)[number];

interface AgendamentoVencido {
  id: string;
  organization_id: string;
  channel_session_id: string;
  group_id: string;
  body: string;
  next_run_at: string;
  recurrence_kind: Recorrencia;
  recurrence_config: Record<string, unknown>;
  repeat_until: string | null;
  max_runs: number | null;
  scheduled_whatsapp_groups: {
    external_group_id: string;
    is_active: boolean;
  } | null;
  channel_sessions: (ChannelSessionRef & {
    id: string;
    organization_id: string;
    status: string;
    archived_at: string | null;
  }) | null;
}

export interface ResultadoDoWorkerDeAgendamentosDeGrupo {
  scanned: number;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mensagemDeErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "erro_desconhecido");
}

export async function executarAgendamentosDeGrupo(
  admin: ReturnType<typeof createAdminClient>,
  now: Date,
  requestId: string,
  limite = LIMITE_PADRAO,
): Promise<ResultadoDoWorkerDeAgendamentosDeGrupo> {
  const sendingPresoAntesDe = new Date(now.getTime() - LIMITE_SENDING_PRESO_MS).toISOString();
  const { error: sendingPresoError } = await admin
    .from("scheduled_group_message_runs")
    .update({
      status: "failed",
      error_code: "worker_timeout",
      error_message: "A execução ficou presa em envio e foi liberada para nova tentativa.",
      updated_at: now.toISOString(),
    })
    .eq("status", "sending")
    .not("claimed_at", "is", null)
    .lte("claimed_at", sendingPresoAntesDe);

  if (sendingPresoError) {
    throw new Error(`scheduled_group_stale_runs_failed: ${sendingPresoError.message}`);
  }

  const { data, error } = await admin
    .from("scheduled_group_messages")
    .select(
      `id, organization_id, channel_session_id, group_id, body, next_run_at, recurrence_kind, recurrence_config, repeat_until, max_runs,
       scheduled_whatsapp_groups!scheduled_group_messages_group_id_fkey(external_group_id, is_active),
       channel_sessions!scheduled_group_messages_channel_org_fkey(id, organization_id, status, archived_at, ${CHANNEL_SESSION_REF_COLUMNS})`,
    )
    .eq("status", "scheduled")
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(Math.max(1, Math.min(limite, 200)));

  if (error) throw new Error(`scheduled_group_query_failed: ${error.message}`);

  const vencidos = (data ?? []) as unknown as AgendamentoVencido[];
  const resultado: ResultadoDoWorkerDeAgendamentosDeGrupo = {
    scanned: vencidos.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const agendamento of vencidos) {
    const scheduledFor = agendamento.next_run_at;
    const workerId = `${requestId}:${randomUUID()}`;

    let runId: string | null = null;
    for (let claimAttempt = 0; claimAttempt < TENTATIVAS_DE_CLAIM; claimAttempt += 1) {
      const { data: latestRun, error: latestRunError } = await admin
        .from("scheduled_group_message_runs")
        .select("attempt")
        .eq("organization_id", agendamento.organization_id)
        .eq("scheduled_message_id", agendamento.id)
        .eq("scheduled_for", scheduledFor)
        .order("attempt", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestRunError) {
        logger.error("[scheduled-group-messages] leitura de tentativa falhou", {
          error: latestRunError.message,
          scheduled_message_id: agendamento.id,
          requestId,
        });
        break;
      }

      const attempt = (latestRun?.attempt ?? 0) + 1;
      const { data: run, error: claimError } = await admin
        .from("scheduled_group_message_runs")
        .insert({
          organization_id: agendamento.organization_id,
          scheduled_message_id: agendamento.id,
          channel_session_id: agendamento.channel_session_id,
          group_id: agendamento.group_id,
          scheduled_for: scheduledFor,
          attempt,
          status: "sending",
          worker_id: workerId,
          claimed_at: now.toISOString(),
          started_at: now.toISOString(),
          metadata: { request_id: requestId },
        })
        .select("id")
        .single();

      if (!claimError) {
        runId = run?.id ?? null;
        break;
      }

      if (claimError.code !== "23505") {
        logger.error("[scheduled-group-messages] claim falhou", {
          error: claimError.message,
          scheduled_message_id: agendamento.id,
          requestId,
        });
        break;
      }
    }

    if (!runId) continue;

    resultado.claimed += 1;

    const falhar = async (codigo: string, erro: string, status: "failed" | "skipped" = "failed") => {
      await admin
        .from("scheduled_group_message_runs")
        .update({
          status,
          error_code: codigo,
          error_message: erro.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .eq("organization_id", agendamento.organization_id);
      if (status === "skipped") resultado.skipped += 1;
      else resultado.failed += 1;
    };

    if (!agendamento.scheduled_whatsapp_groups?.is_active) {
      await falhar("group_inactive", "Grupo inativo no cadastro de agendamentos.", "skipped");
      continue;
    }

    if (!agendamento.channel_sessions || agendamento.channel_sessions.archived_at) {
      await falhar("channel_unavailable", "Conexão de envio não encontrada ou arquivada.");
      continue;
    }

    let externalId: string | null = null;
    try {
      const adapter = getAdapter(agendamento.channel_sessions.provider as ChannelProvider);
      if (!adapter.isConfigured()) {
        await falhar(adapter.codes.notConfigured, "Transporte de envio não configurado.");
        continue;
      }

      externalId = (
        await adapter.send({
          organizationId: agendamento.organization_id,
          sessionRef: resolveSessionRef(agendamento.channel_sessions),
          to: agendamento.scheduled_whatsapp_groups.external_group_id,
          kind: "text",
          body: agendamento.body,
        })
      ).externalId;

      if (!externalId) {
        await falhar(adapter.codes.sendFailed, "Transporte aceitou a chamada sem devolver id externo.");
        continue;
      }
    } catch (err) {
      await falhar("send_failed", mensagemDeErro(err));
      continue;
    }

    const { count } = await admin
      .from("scheduled_group_message_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", agendamento.organization_id)
      .eq("scheduled_message_id", agendamento.id)
      .eq("status", "sent");

    const runsCount = (count ?? 0) + 1;
    const nextRun = proximaExecucaoRecorrente({
      recurrence_kind: agendamento.recurrence_kind,
      recurrence_config: jsonObject(agendamento.recurrence_config),
      scheduled_for: scheduledFor,
      repeat_until: agendamento.repeat_until,
      runs_count: runsCount,
      max_runs: agendamento.max_runs,
    });

    const sentAt = new Date().toISOString();
    const { error: finalizeError } = await admin
      .from("scheduled_group_message_runs")
      .update({
        status: "sent",
        sent_at: sentAt,
        external_message_id: externalId,
        updated_at: sentAt,
      })
      .eq("id", runId)
      .eq("organization_id", agendamento.organization_id);

    if (finalizeError) {
      logger.error("[scheduled-group-messages] finalize run falhou", {
        error: finalizeError.message,
        run_id: runId,
        requestId,
      });
    }

    const { error: scheduleError } = await admin
      .from("scheduled_group_messages")
      .update({
        status: nextRun ? "scheduled" : "completed",
        next_run_at: nextRun,
        last_run_at: sentAt,
        updated_at: sentAt,
      })
      .eq("id", agendamento.id)
      .eq("organization_id", agendamento.organization_id)
      .eq("next_run_at", scheduledFor);

    if (scheduleError) {
      logger.error("[scheduled-group-messages] atualizar agendamento falhou", {
        error: scheduleError.message,
        scheduled_message_id: agendamento.id,
        requestId,
      });
    }

    resultado.sent += 1;
  }

  return resultado;
}
