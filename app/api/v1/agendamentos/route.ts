import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import {
  criarAgendamentoDeGrupoSchema,
  filtrosDeAgendamentosDeGrupoSchema,
  gruposDoPedido,
  loteDoMetadata,
  metadataComLote,
  metadataComMidiasAgendadas,
  midiaAgendadaDoMetadata,
  midiasAgendadasDoMetadata,
  midiasDoPedido,
  proximaExecucaoInicial,
} from "@/lib/agendamentos-grupos/schema";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { isScheduledMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, organization_id, channel_session_id, group_id, title, body, status, starts_at, timezone, recurrence_kind, recurrence_config, repeat_until, max_runs, next_run_at, last_run_at, created_at, updated_at, created_by, updated_by, cancelled_at, cancelled_by, cancel_reason, metadata, scheduled_whatsapp_groups!scheduled_group_messages_group_id_fkey(name, external_group_id)";

const COLUNAS_DA_ULTIMA_EXECUCAO =
  "id, scheduled_message_id, scheduled_for, status, attempt, claimed_at, started_at, sent_at, error_code, error_message, created_at, updated_at";

function apresentarAgendamento(
  row: Record<string, unknown>,
  latestExecution: Record<string, unknown> | null = null,
) {
  return {
    ...row,
    media: midiaAgendadaDoMetadata(row.metadata),
    media_items: midiasAgendadasDoMetadata(row.metadata),
    batch: loteDoMetadata(row.metadata),
    latest_execution: latestExecution,
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    feature: "broadcast",
    requestId,
    resource: "scheduled_group_messages",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = filtrosDeAgendamentosDeGrupoSchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return fail("validation_failed", t("Parâmetros inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const admin = createAdminClient();
  let query = admin
    .from("scheduled_group_messages")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("next_run_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.status) query = query.eq("status", parsed.data.status);
  if (parsed.data.group_id) query = query.eq("group_id", parsed.data.group_id);
  if (parsed.data.channel_session_id)
    query = query.eq("channel_session_id", parsed.data.channel_session_id);

  const { data, error } = await query;
  if (error)
    return fail("internal_error", t("Erro ao listar os agendamentos."), 500, { requestId });

  const schedules = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;
  const latestBySchedule = new Map<string, Record<string, unknown>>();
  if (schedules.length > 0) {
    const { data: runs, error: runsError } = await admin
      .from("scheduled_group_message_runs")
      .select(COLUNAS_DA_ULTIMA_EXECUCAO)
      .eq("organization_id", authz.org.orgId)
      .in(
        "scheduled_message_id",
        schedules.map(({ id }) => id),
      )
      .order("scheduled_for", { ascending: false })
      .order("attempt", { ascending: false })
      .order("created_at", { ascending: false });

    if (runsError) {
      return fail("internal_error", t("Erro ao carregar o estado dos disparos."), 500, {
        requestId,
      });
    }
    for (const run of (runs ?? []) as unknown as Array<
      Record<string, unknown> & { scheduled_message_id: string }
    >) {
      if (!latestBySchedule.has(run.scheduled_message_id)) {
        latestBySchedule.set(run.scheduled_message_id, run);
      }
    }
  }

  return ok(
    {
      schedules: schedules.map((schedule) =>
        apresentarAgendamento(schedule, latestBySchedule.get(schedule.id) ?? null),
      ),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    feature: "broadcast",
    requestId,
    resource: "scheduled_group_messages",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = criarAgendamentoDeGrupoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const agendamento = parsed.data;
  const groupIds = gruposDoPedido(agendamento);
  if (groupIds.length === 0) {
    return fail("validation_failed", t("Selecione pelo menos um grupo."), 422, { requestId });
  }
  const medias = midiasDoPedido(agendamento) ?? [];
  if (medias.some((m) => !isScheduledMediaPathOwnedBy(m.storage_path, authz.org.orgId))) {
    return fail("validation_failed", t("A mídia não pertence a esta organização."), 422, {
      requestId,
    });
  }
  const nextRun = proximaExecucaoInicial({
    status: agendamento.status,
    starts_at: agendamento.starts_at,
  });

  const admin = createAdminClient();

  // A conexão de cada agendamento é a do PRÓPRIO grupo, lida do banco e
  // filtrada pela organização — nunca do corpo. Um id de grupo de outra
  // organização simplesmente não volta daqui, e o pedido inteiro é recusado.
  const { data: gruposDoBanco, error: erroGrupos } = await admin
    .from("scheduled_whatsapp_groups")
    .select("id, channel_session_id, is_active")
    .eq("organization_id", authz.org.orgId)
    .in("id", groupIds);
  if (erroGrupos) {
    return fail("internal_error", t("Erro ao conferir os grupos."), 500, { requestId });
  }
  const conexaoPorGrupo = new Map(
    (gruposDoBanco ?? []).map((g) => [g.id as string, g.channel_session_id as string]),
  );
  if (groupIds.some((id) => !conexaoPorGrupo.has(id))) {
    return fail("validation_failed", t("Grupo ou conexão não encontrados."), 422, { requestId });
  }
  if (
    agendamento.channel_session_id &&
    groupIds.length === 1 &&
    conexaoPorGrupo.get(groupIds[0]!) !== agendamento.channel_session_id
  ) {
    return fail("validation_failed", t("Grupo ou conexão não encontrados."), 422, { requestId });
  }

  const metadataBase = metadataComMidiasAgendadas(agendamento.metadata, medias);
  const loteId = groupIds.length > 1 ? randomUUID() : null;
  const linhas = groupIds.map((groupId, index) => ({
    organization_id: authz.org.orgId,
    channel_session_id: conexaoPorGrupo.get(groupId)!,
    group_id: groupId,
    title: agendamento.title ?? null,
    body: agendamento.body,
    status: agendamento.status,
    starts_at: agendamento.starts_at,
    timezone: agendamento.timezone,
    recurrence_kind: agendamento.recurrence_kind,
    recurrence_config: agendamento.recurrence_config,
    repeat_until: agendamento.repeat_until ?? null,
    max_runs: agendamento.max_runs ?? null,
    next_run_at: nextRun,
    metadata: metadataComLote(
      metadataBase,
      loteId ? { id: loteId, size: groupIds.length, index } : null,
    ),
    created_by: authz.user.id,
    updated_by: authz.user.id,
  }));

  // Um INSERT só: ou todos os grupos entram, ou nenhum — um lote pela metade
  // seria um disparo que saiu para "alguns" sem ninguém saber quais.
  const { data, error } = await admin
    .from("scheduled_group_messages")
    .insert(linhas)
    .select(COLUNAS);

  if (error) {
    if (error.code === "23503")
      return fail("validation_failed", t("Grupo ou conexão não encontrados."), 422, { requestId });
    if (error.code === "23514")
      return fail("validation_failed", t("Dados fora das regras do agendamento."), 422, {
        requestId,
      });
    return fail("internal_error", t("Erro ao criar o agendamento."), 500, { requestId });
  }

  const criados = (data ?? []) as unknown as Array<
    Record<string, unknown> & { id: string; group_id: string }
  >;
  await Promise.all(
    criados.map((linha) =>
      audit({
        organizationId: authz.org.orgId,
        actorUserId: authz.user.id,
        action: "scheduled_group.message_created",
        resourceType: "scheduled_group_messages",
        resourceId: linha.id,
        requestId,
        metadata: {
          status: agendamento.status,
          group_id: linha.group_id,
          next_run_at: nextRun,
          has_media: medias.length > 0,
          media_count: medias.length,
          batch_id: loteId,
          batch_size: groupIds.length,
        },
      }),
    ),
  );

  const schedules = criados.map((linha) => apresentarAgendamento(linha));
  return ok({ schedule: schedules[0] ?? null, schedules }, { requestId, status: 201 });
}
