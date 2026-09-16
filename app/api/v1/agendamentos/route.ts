import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import {
  criarAgendamentoDeGrupoSchema,
  filtrosDeAgendamentosDeGrupoSchema,
  proximaExecucaoInicial,
} from "@/lib/agendamentos-grupos/schema";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, organization_id, channel_session_id, group_id, title, body, status, starts_at, timezone, recurrence_kind, recurrence_config, repeat_until, max_runs, next_run_at, last_run_at, created_at, updated_at, created_by, updated_by, cancelled_at, cancelled_by, cancel_reason, metadata, scheduled_whatsapp_groups!scheduled_group_messages_group_id_fkey(name, external_group_id)";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "scheduled_group_messages" });
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

  let query = createAdminClient()
    .from("scheduled_group_messages")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("next_run_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.status) query = query.eq("status", parsed.data.status);
  if (parsed.data.group_id) query = query.eq("group_id", parsed.data.group_id);
  if (parsed.data.channel_session_id) query = query.eq("channel_session_id", parsed.data.channel_session_id);

  const { data, error } = await query;
  if (error) return fail("internal_error", t("Erro ao listar os agendamentos."), 500, { requestId });
  return ok({ schedules: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "scheduled_group_messages" });
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
  const nextRun = proximaExecucaoInicial({
    status: agendamento.status,
    starts_at: agendamento.starts_at,
  });

  const { data, error } = await createAdminClient()
    .from("scheduled_group_messages")
    .insert({
      organization_id: authz.org.orgId,
      channel_session_id: agendamento.channel_session_id,
      group_id: agendamento.group_id,
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
      metadata: agendamento.metadata ?? {},
      created_by: authz.user.id,
      updated_by: authz.user.id,
    })
    .select(COLUNAS)
    .single();

  if (error) {
    if (error.code === "23503") return fail("validation_failed", t("Grupo ou conexão não encontrados."), 422, { requestId });
    if (error.code === "23514") return fail("validation_failed", t("Dados fora das regras do agendamento."), 422, { requestId });
    return fail("internal_error", t("Erro ao criar o agendamento."), 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "scheduled_group.message_created",
    resourceType: "scheduled_group_messages",
    resourceId: data.id,
    requestId,
    metadata: { status: agendamento.status, group_id: agendamento.group_id, next_run_at: nextRun },
  });

  return ok({ schedule: data }, { requestId, status: 201 });
}
