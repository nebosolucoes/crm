import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import {
  alterarAgendamentoDeGrupoSchema,
  metadataComMidiaAgendada,
  midiaAgendadaDoMetadata,
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

function apresentarAgendamento(row: Record<string, unknown>) {
  return { ...row, media: midiaAgendadaDoMetadata(row.metadata) };
}

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "scheduled_group_messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = alterarAgendamentoDeGrupoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  if (
    parsed.data.media &&
    !isScheduledMediaPathOwnedBy(parsed.data.media.storage_path, authz.org.orgId)
  ) {
    return fail("validation_failed", t("A mídia não pertence a esta organização."), 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const { data: atual, error: erroAtual } = await admin
    .from("scheduled_group_messages")
    .select("status, starts_at, metadata")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .single();

  if (erroAtual) {
    if (erroAtual.code === "PGRST116")
      return fail("not_found", t("Agendamento não encontrado."), 404, { requestId });
    return fail("internal_error", t("Erro ao carregar o agendamento."), 500, { requestId });
  }

  const { media, metadata, ...alteracoes } = parsed.data;
  const mediaAtual = midiaAgendadaDoMetadata(atual.metadata);
  const mediaResolvida = media === undefined ? mediaAtual : media;
  const metadataMesclado = {
    ...((atual.metadata as Record<string, unknown> | null) ?? {}),
    ...(metadata ?? {}),
  };
  const patch = {
    ...alteracoes,
    updated_by: authz.user.id,
    ...(media !== undefined || metadata !== undefined
      ? { metadata: metadataComMidiaAgendada(metadataMesclado, mediaResolvida) }
      : {}),
  };
  if (parsed.data.status || parsed.data.starts_at) {
    const status = parsed.data.status ?? atual.status;
    const startsAt = parsed.data.starts_at ?? atual.starts_at;
    Object.assign(patch, {
      next_run_at: proximaExecucaoInicial({ status, starts_at: startsAt }),
    });
  }

  const { data, error } = await admin
    .from("scheduled_group_messages")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(COLUNAS)
    .single();

  if (error) {
    if (error.code === "PGRST116")
      return fail("not_found", t("Agendamento não encontrado."), 404, { requestId });
    if (error.code === "23503")
      return fail("validation_failed", t("Grupo ou conexão não encontrados."), 422, { requestId });
    if (error.code === "23514")
      return fail("validation_failed", t("Dados fora das regras do agendamento."), 422, {
        requestId,
      });
    return fail("internal_error", t("Erro ao salvar o agendamento."), 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "scheduled_group.message_updated",
    resourceType: "scheduled_group_messages",
    resourceId: id,
    requestId,
    metadata: { campos: Object.keys(parsed.data), has_media: Boolean(mediaResolvida) },
  });

  return ok(
    { schedule: apresentarAgendamento(data as unknown as Record<string, unknown>) },
    { requestId },
  );
}

export async function GET(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "scheduled_group_messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { data, error } = await createAdminClient()
    .from("scheduled_group_messages")
    .select(COLUNAS)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .single();

  if (error) {
    if (error.code === "PGRST116")
      return fail("not_found", t("Agendamento não encontrado."), 404, { requestId });
    return fail("internal_error", t("Erro ao carregar o agendamento."), 500, { requestId });
  }

  return ok(
    { schedule: apresentarAgendamento(data as unknown as Record<string, unknown>) },
    { requestId },
  );
}
