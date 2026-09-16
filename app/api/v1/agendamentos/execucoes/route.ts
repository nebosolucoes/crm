import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { filtrosDeExecucoesDeGrupoSchema } from "@/lib/agendamentos-grupos/schema";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, organization_id, scheduled_message_id, channel_session_id, group_id, scheduled_for, status, attempt, worker_id, claimed_at, started_at, sent_at, external_message_id, error_code, error_message, created_at, updated_at, metadata, scheduled_group_messages!scheduled_group_message_runs_message_org_fkey(title, body), scheduled_whatsapp_groups!scheduled_group_message_runs_group_id_fkey(name, external_group_id)";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "scheduled_group_message_runs" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = filtrosDeExecucoesDeGrupoSchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return fail("validation_failed", t("Parâmetros inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  let query = createAdminClient()
    .from("scheduled_group_message_runs")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("scheduled_for", { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.status) query = query.eq("status", parsed.data.status);
  if (parsed.data.scheduled_message_id) query = query.eq("scheduled_message_id", parsed.data.scheduled_message_id);
  if (parsed.data.group_id) query = query.eq("group_id", parsed.data.group_id);

  const { data, error } = await query;
  if (error) return fail("internal_error", t("Erro ao listar as execuções."), 500, { requestId });
  return ok({ runs: data ?? [] }, { requestId });
}
