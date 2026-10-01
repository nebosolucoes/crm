/**
 * GET/PATCH /api/v1/settings/comentarios — a política de comentários da
 * organização (spec 22 §5.2 e §8), em `organizations.settings.comentarios`:
 *
 *   - `fechar_ao_responder`: responder pelo CRM fecha o atendimento (default sim);
 *   - `prazo_sem_resposta_horas`: depois disso, aviso na Central (default 4).
 *
 * manager+, como o resto de Configurações › Atendimento. A escrita vai pelo
 * admin client pelo mesmo motivo de `settings/routing` (a policy de escrita de
 * `organizations` é só de super-admin), com merge que preserva as outras chaves.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { lerPoliticaDeComentarios, politicaDeComentariosSchema } from "@/lib/channels/comentarios/politica";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_comentarios" });
  if (!authz.ok) return authz.response;
  const { data, error } = await createAdminClient()
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(lerPoliticaDeComentarios(data?.settings), { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_comentarios" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const lido = politicaDeComentariosSchema.strict().safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", t("O prazo do aviso vai de 1 a 168 horas."), 422, { requestId });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const atuais = (data?.settings as Record<string, unknown> | null) ?? {};
  const antes = lerPoliticaDeComentarios(atuais);

  const { error: erroGravar } = await admin
    .from("organizations")
    .update({ settings: { ...atuais, comentarios: lido.data } })
    .eq("id", authz.org.orgId);
  if (erroGravar) return fail("internal_error", erroGravar.message, 500, { requestId });

  void audit({
    action: "settings.comentarios_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { antes, depois: lido.data },
  });
  return ok(lido.data, { requestId });
}
