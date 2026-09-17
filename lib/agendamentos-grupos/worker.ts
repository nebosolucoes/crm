import { randomUUID } from "node:crypto";

import { getAdapter } from "@/lib/channels";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";
import type { ChannelProvider } from "@/lib/channels/types";
import { avisarBloqueioPorRecurso } from "@/lib/entitlements/aviso-na-central";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

import { midiaAgendadaDoMetadata, proximaExecucaoRecorrente } from "./schema";
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
  metadata: Record<string, unknown>;
  next_run_at: string;
  recurrence_kind: Recorrencia;
  recurrence_config: Record<string, unknown>;
  repeat_until: string | null;
  max_runs: number | null;
  scheduled_whatsapp_groups: {
    external_group_id: string;
    is_active: boolean;
  } | null;
  channel_sessions:
    | (ChannelSessionRef & {
        id: string;
        organization_id: string;
        status: string;
        archived_at: string | null;
      })
    | null;
}

export interface ResultadoDoWorkerDeAgendamentosDeGrupo {
  scanned: number;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function contarEnviosConcluidos(
  admin: AdminClient,
  agendamento: Pick<AgendamentoVencido, "id" | "organization_id">,
): Promise<number> {
  const { count, error } = await admin
    .from("scheduled_group_message_runs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", agendamento.organization_id)
    .eq("scheduled_message_id", agendamento.id)
    .eq("status", "sent");
  if (error) throw new Error(`scheduled_group_sent_count_failed: ${error.message}`);
  return count ?? 0;
}

async function avancarAgendamentoDepoisDaTentativa(
  admin: AdminClient,
  agendamento: AgendamentoVencido,
  scheduledFor: string,
  finishedAt: string,
  runsCount: number,
  requestId: string,
): Promise<void> {
  const nextRun = proximaExecucaoRecorrente({
    recurrence_kind: agendamento.recurrence_kind,
    recurrence_config: jsonObject(agendamento.recurrence_config),
    scheduled_for: scheduledFor,
    repeat_until: agendamento.repeat_until,
    runs_count: runsCount,
    max_runs: agendamento.max_runs,
  });

  const { error } = await admin
    .from("scheduled_group_messages")
    .update({
      status: nextRun ? "scheduled" : "completed",
      next_run_at: nextRun,
      last_run_at: finishedAt,
      updated_at: finishedAt,
    })
    .eq("id", agendamento.id)
    .eq("organization_id", agendamento.organization_id)
    .eq("status", "scheduled")
    .eq("next_run_at", scheduledFor);

  if (error) {
    logger.error("[scheduled-group-messages] atualizar agendamento falhou", {
      error: error.message,
      scheduled_message_id: agendamento.id,
      requestId,
    });
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mensagemDeErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "erro_desconhecido");
}

/**
 * A organização tem Disparo no plano (migration 0275)? Uma consulta por
 * organização por rodada. Erro da consulta NÃO bloqueia o envio — um disparo
 * agendado por quem tem o recurso não pode deixar de sair por um blip do
 * banco (`null` = não deu para saber → segue).
 */
async function organizacaoTemDisparo(
  admin: AdminClient,
  memoria: Map<string, boolean>,
  organizationId: string,
  requestId: string,
): Promise<boolean | null> {
  const lembrado = memoria.get(organizationId);
  if (lembrado !== undefined) return lembrado;
  const { data, error } = await admin.rpc("fn_org_has_feature", {
    p_org: organizationId,
    p_feature: "broadcast",
  });
  if (error) {
    logger.warn("[scheduled-group-messages] plano não pôde ser conferido — seguindo com o envio", {
      organization_id: organizationId,
      error: error.message,
      requestId,
    });
    return null;
  }
  const tem = data === true;
  memoria.set(organizationId, tem);
  return tem;
}

export async function executarAgendamentosDeGrupo(
  admin: AdminClient,
  now: Date,
  requestId: string,
  limite = LIMITE_PADRAO,
): Promise<ResultadoDoWorkerDeAgendamentosDeGrupo> {
  const planoPorOrg = new Map<string, boolean>();
  const sendingPresoAntesDe = new Date(now.getTime() - LIMITE_SENDING_PRESO_MS).toISOString();
  const { error: sendingPresoError } = await admin
    .from("scheduled_group_message_runs")
    .update({
      status: "failed",
      error_code: "worker_timeout",
      error_message: "A execução ficou presa e foi encerrada sem reenvio automático.",
      updated_at: now.toISOString(),
    })
    .in("status", ["pending", "sending"])
    .not("claimed_at", "is", null)
    .lte("claimed_at", sendingPresoAntesDe);

  if (sendingPresoError) {
    throw new Error(`scheduled_group_stale_runs_failed: ${sendingPresoError.message}`);
  }

  const { data, error } = await admin
    .from("scheduled_group_messages")
    .select(
      `id, organization_id, channel_session_id, group_id, body, metadata, next_run_at, recurrence_kind, recurrence_config, repeat_until, max_runs,
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
        .select("attempt, status")
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

      if (latestRun?.status === "pending" || latestRun?.status === "sending") {
        // Outra rodada já é dona desta ocorrência. Não inventa um attempt novo
        // enquanto o primeiro ainda pode produzir um efeito irreversível.
        break;
      }
      if (
        latestRun?.status === "sent" ||
        latestRun?.status === "failed" ||
        latestRun?.status === "skipped" ||
        latestRun?.status === "cancelled"
      ) {
        // A tentativa terminou, mas o update do agendamento pai pode ter
        // falhado. Repara o relógio sem reenviar a mesma ocorrência.
        await avancarAgendamentoDepoisDaTentativa(
          admin,
          agendamento,
          scheduledFor,
          new Date().toISOString(),
          await contarEnviosConcluidos(admin, agendamento),
          requestId,
        );
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
          status: "pending",
          worker_id: workerId,
          claimed_at: now.toISOString(),
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

    // A linha pending nasce antes de qualquer chamada externa. Se o processo
    // cair daqui para a frente, a tela ainda registra que o horário chegou.
    await admin
      .from("scheduled_group_messages")
      .update({ last_run_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", agendamento.id)
      .eq("organization_id", agendamento.organization_id)
      .eq("status", "scheduled")
      .eq("next_run_at", scheduledFor);

    const { error: sendingError } = await admin
      .from("scheduled_group_message_runs")
      .update({ status: "sending", started_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", runId)
      .eq("organization_id", agendamento.organization_id)
      .eq("status", "pending");

    if (sendingError) {
      logger.error("[scheduled-group-messages] transição para envio falhou", {
        error: sendingError.message,
        run_id: runId,
        requestId,
      });
      continue;
    }

    const sentCountBefore = await contarEnviosConcluidos(admin, agendamento);

    const falhar = async (
      codigo: string,
      erro: string,
      status: "failed" | "skipped" = "failed",
    ) => {
      const finishedAt = new Date().toISOString();
      const { error: runError } = await admin
        .from("scheduled_group_message_runs")
        .update({
          status,
          error_code: codigo,
          error_message: erro.slice(0, 500),
          updated_at: finishedAt,
        })
        .eq("id", runId)
        .eq("organization_id", agendamento.organization_id);
      if (runError) throw new Error(`scheduled_group_run_finalize_failed: ${runError.message}`);

      await avancarAgendamentoDepoisDaTentativa(
        admin,
        agendamento,
        scheduledFor,
        finishedAt,
        sentCountBefore,
        requestId,
      );
      if (status === "skipped") resultado.skipped += 1;
      else resultado.failed += 1;
    };

    // O plano ANTES do grupo e da conexão: é a condição mais barata e a que a
    // organização inteira compartilha. `skipped`, não `failed` — nada quebrou;
    // e o relógio avança, senão a mesma ocorrência voltaria a cada minuto.
    if ((await organizacaoTemDisparo(admin, planoPorOrg, agendamento.organization_id, requestId)) === false) {
      await falhar("feature_not_entitled", "Disparo não está incluído no plano da organização.", "skipped");
      void avisarBloqueioPorRecurso(admin, agendamento.organization_id, "broadcast", "Um disparo programado");
      continue;
    }

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

      const media = midiaAgendadaDoMetadata(agendamento.metadata);
      let mediaAssinada:
        | { url: string; mime: string; filename?: string | null; caption?: string | null }
        | undefined;
      if (media) {
        const { data: signed, error: signError } = await admin.storage
          .from("whatsapp-media")
          .createSignedUrl(media.storage_path, 600);
        if (signError || !signed?.signedUrl) {
          await falhar("storage_sign_failed", "Não foi possível preparar a mídia para envio.");
          continue;
        }
        mediaAssinada = {
          url: signed.signedUrl,
          mime: media.mime,
          filename: media.filename,
          caption: agendamento.body,
        };
      }

      externalId = (
        await adapter.send({
          organizationId: agendamento.organization_id,
          sessionRef: resolveSessionRef(agendamento.channel_sessions),
          to: agendamento.scheduled_whatsapp_groups.external_group_id,
          kind: media?.kind ?? "text",
          body: agendamento.body,
          media: mediaAssinada,
        })
      ).externalId;

      if (!externalId) {
        await falhar(
          adapter.codes.sendFailed,
          "Transporte aceitou a chamada sem devolver id externo.",
        );
        continue;
      }
    } catch (err) {
      await falhar("send_failed", mensagemDeErro(err));
      continue;
    }

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
      // O efeito externo aconteceu, mas sem o recibo persistido não é seguro
      // declarar sucesso nem liberar outro slot. A recuperação de execução
      // presa fechará como falha/resultado incerto sem reenviar esta ocorrência.
      continue;
    }

    await avancarAgendamentoDepoisDaTentativa(
      admin,
      agendamento,
      scheduledFor,
      sentAt,
      sentCountBefore + 1,
      requestId,
    );

    resultado.sent += 1;
  }

  return resultado;
}
