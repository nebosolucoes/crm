import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "scheduled_group_messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { data: atual, error: readError } = await createAdminClient()
    .from("scheduled_group_messages")
    .select("starts_at")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .eq("status", "paused")
    .maybeSingle();

  if (readError) return fail("internal_error", t("Erro ao retomar o agendamento."), 500, { requestId });
  if (!atual) return fail("not_found", t("Agendamento não encontrado ou não está pausado."), 404, { requestId });

  const { data, error } = await createAdminClient()
    .from("scheduled_group_messages")
    .update({ status: "scheduled", next_run_at: atual.starts_at, updated_by: authz.user.id })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .eq("status", "paused")
    .select("id, status, next_run_at")
    .single();

  if (error) return fail("internal_error", t("Erro ao retomar o agendamento."), 500, { requestId });

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "scheduled_group.message_resumed",
    resourceType: "scheduled_group_messages",
    resourceId: id,
    requestId,
  });

  return ok({ schedule: data }, { requestId });
}
