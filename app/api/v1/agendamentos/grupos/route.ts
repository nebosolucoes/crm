import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { grupoDoWhatsappSchema } from "@/lib/agendamentos-grupos/schema";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, organization_id, channel_session_id, external_group_id, name, is_active, last_seen_at, metadata, created_at, updated_at, created_by";

const filtrosSchema = z.object({
  channel_session_id: z.string().uuid().optional(),
  active: z.enum(["true", "false"]).optional(),
});

const syncSchema = z.object({
  groups: z.array(grupoDoWhatsappSchema.omit({ channel_session_id: true })).min(1).max(500),
  channel_session_id: z.string().uuid(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "scheduled_whatsapp_groups" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = filtrosSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return fail("validation_failed", t("Parâmetros inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  let query = createAdminClient()
    .from("scheduled_whatsapp_groups")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("name", { ascending: true });

  if (parsed.data.channel_session_id) query = query.eq("channel_session_id", parsed.data.channel_session_id);
  if (parsed.data.active === "true") query = query.eq("is_active", true);
  if (parsed.data.active === "false") query = query.eq("is_active", false);

  const { data, error } = await query;
  if (error) return fail("internal_error", t("Erro ao listar os grupos."), 500, { requestId });
  return ok({ groups: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "scheduled_whatsapp_groups" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const raw = await req.json().catch(() => null);
  const sync = syncSchema.safeParse(raw);
  const single = grupoDoWhatsappSchema.safeParse(raw);
  if (!sync.success && !single.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: single.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const rows = sync.success
    ? sync.data.groups.map((g) => ({ ...g, channel_session_id: sync.data.channel_session_id }))
    : [single.data!];

  const payload = rows.map((g) => ({
    organization_id: authz.org.orgId,
    channel_session_id: g.channel_session_id,
    external_group_id: g.external_group_id,
    name: g.name,
    is_active: g.is_active ?? true,
    last_seen_at: g.last_seen_at ?? new Date().toISOString(),
    metadata: g.metadata ?? {},
    created_by: authz.user.id,
  }));

  const { data, error } = await createAdminClient()
    .from("scheduled_whatsapp_groups")
    .upsert(payload, { onConflict: "organization_id,channel_session_id,external_group_id" })
    .select(COLUNAS);

  if (error) {
    if (error.code === "23503") return fail("validation_failed", t("Conexão não encontrada."), 422, { requestId });
    return fail("internal_error", t("Erro ao salvar os grupos."), 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: sync.success ? "scheduled_group.groups_synced" : "scheduled_group.group_saved",
    resourceType: "scheduled_whatsapp_groups",
    requestId,
    metadata: { total: payload.length, channel_session_id: payload[0]?.channel_session_id ?? null },
  });

  return ok({ groups: data ?? [] }, { requestId, status: sync.success ? 200 : 201 });
}
