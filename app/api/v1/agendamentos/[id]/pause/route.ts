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
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "scheduled_group_messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { data, error } = await createAdminClient()
    .from("scheduled_group_messages")
    .update({ status: "paused", next_run_at: null, updated_by: authz.user.id })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .in("status", ["scheduled", "draft"])
    .select("id, status, next_run_at")
    .single();

  if (error) {
    if (error.code === "PGRST116") return fail("not_found", t("Agendamento não encontrado ou não pode ser pausado."), 404, { requestId });
    return fail("internal_error", t("Erro ao pausar o agendamento."), 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "scheduled_group.message_paused",
    resourceType: "scheduled_group_messages",
    resourceId: id,
    requestId,
  });

  return ok({ schedule: data }, { requestId });
}
