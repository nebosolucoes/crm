import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * /api/v1/sectors/[id] — editar e apagar um setor (spec 20 §2, §4). manager+.
 *
 * PATCH  nome, slug, descrição (o que a IA lê), escopo, ativo/inativo.
 *        Desativar é o caminho NORMAL de tirar um setor de circulação: as
 *        conversas dele caem na regra antiga de visibilidade e a vaga do plano
 *        volta (`max_sectors` conta só ativos).
 * DELETE só quando não há conversa ABERTA no setor — senão 409 com a contagem,
 *        para a pessoa transferir ou desativar. Conversas encerradas e agentes
 *        que apontavam para ele têm a referência anulada antes (a FK é
 *        `restrict` de propósito: um `set null` composto anularia a organização).
 *        O histórico em `conversation_assignment_events` fica (FK `set null`).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, noContent, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { updateSectorSchema } from "@/lib/schemas/setores";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { achatarMembros, SECTOR_COLUMNS } from "@/lib/setores/colunas";

export const dynamic = "force-dynamic";

/** Os status em que uma conversa ainda pede atendimento — mesmo conjunto do roteamento. */
const STATUS_ABERTOS = ["open", "pending", "claimed", "ai_handling"];

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "inbox", requestId, resource: "sectors" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = updateSectorSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sectors")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select(`${SECTOR_COLUMNS}, sector_members(user_id)`)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return fail("state_conflict", t("Já existe um setor com este identificador."), 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) return fail("not_found", t("Setor não encontrado."), 404, { requestId });

  void audit({
    action: "sector.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "sector",
    resourceId: data.id,
    requestId,
    metadata: { fields: Object.keys(parsed.data) },
  });
  return ok(achatarMembros(data as Record<string, unknown>), { requestId });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "inbox", requestId, resource: "sectors" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;
  const { id } = await params;

  // Service role bypassa RLS: toda consulta abaixo filtra a organização
  // resolvida da sessão, nunca do body.
  const admin = createAdminClient();
  const { data: setor, error: setorErr } = await admin
    .from("sectors")
    .select("id, name")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (setorErr) return fail("internal_error", setorErr.message, 500, { requestId });
  if (!setor) return fail("not_found", t("Setor não encontrado."), 404, { requestId });

  const { count: abertas, error: abertasErr } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.orgId)
    .eq("sector_id", id)
    .in("status", STATUS_ABERTOS);
  if (abertasErr) return fail("internal_error", abertasErr.message, 500, { requestId });
  if ((abertas ?? 0) > 0) {
    return fail(
      "state_conflict",
      t("Há conversas abertas neste setor. Transfira-as ou desative o setor em vez de excluir."),
      409,
      { requestId, details: { open_conversations: abertas } },
    );
  }

  // Referências que sobraram (conversas encerradas, agentes de IA) são anuladas
  // antes: a FK é restrict. Ordem: primeiro quem aponta, depois o setor.
  const { error: convErr } = await admin
    .from("conversations")
    .update({ sector_id: null })
    .eq("organization_id", org.orgId)
    .eq("sector_id", id);
  if (convErr) return fail("internal_error", convErr.message, 500, { requestId });
  const { error: agErr } = await admin
    .from("ai_agents")
    .update({ sector_id: null })
    .eq("organization_id", org.orgId)
    .eq("sector_id", id);
  if (agErr) return fail("internal_error", agErr.message, 500, { requestId });

  // O apagamento em si vai pela sessão: a RLS confirma manager+ na organização
  // e `.select()` prova que a linha existia e foi apagada.
  const supabase = await createClient();
  const { data: apagado, error } = await supabase
    .from("sectors")
    .delete()
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!apagado) return fail("not_found", t("Setor não encontrado."), 404, { requestId });

  void audit({
    action: "sector.deleted",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "sector",
    resourceId: id,
    requestId,
    metadata: { name: setor.name },
  });
  return noContent(requestId);
}
