import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { cancelarAgendamentoDeGrupoSchema } from "@/lib/agendamentos-grupos/schema";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "scheduled_group_messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = cancelarAgendamentoDeGrupoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const now = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("scheduled_group_messages")
    .update({
      status: "cancelled",
      next_run_at: null,
      cancelled_at: now,
      cancelled_by: authz.user.id,
      cancel_reason: parsed.data.reason,
      updated_by: authz.user.id,
    })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .neq("status", "cancelled")
    .select("id, status, cancelled_at, cancel_reason")
    .single();

  if (error) {
    if (error.code === "PGRST116") return fail("not_found", t("Agendamento não encontrado."), 404, { requestId });
    return fail("internal_error", t("Erro ao cancelar o agendamento."), 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "scheduled_group.message_cancelled",
    resourceType: "scheduled_group_messages",
    resourceId: id,
    requestId,
    metadata: { reason: parsed.data.reason },
  });

  return ok({ schedule: data }, { requestId });
}
