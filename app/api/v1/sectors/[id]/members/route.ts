import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PUT /api/v1/sectors/[id]/members — quem atende neste setor (spec 20 §4). manager+.
 *
 * Recebe a lista INTEIRA e substitui o conjunto: é o que a tela de Setores
 * envia ao salvar, e é o que torna a chamada idempotente. Ordem de escrita
 * pensada para nunca deixar o setor vazio no meio do caminho — primeiro entram
 * os novos, depois saem os que não estão na lista. Setor vazio é uma escolha
 * explícita da pessoa (lista vazia), não um estado intermediário.
 *
 * Todo id tem que ser membro ATIVO agent+ desta organização: a FK composta a
 * `user_organizations` recusa gente de fora, mas o erro do banco seria 23503
 * sem dizer QUEM — aqui a resposta nomeia os ids recusados.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { setSectorMembersSchema } from "@/lib/schemas/setores";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "inbox", requestId, resource: "sectors" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = setSectorMembersSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const desejados = [...new Set(parsed.data.user_ids)];

  const admin = createAdminClient();
  const { data: setor, error: setorErr } = await admin
    .from("sectors")
    .select("id")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (setorErr) return fail("internal_error", setorErr.message, 500, { requestId });
  if (!setor) return fail("not_found", t("Setor não encontrado."), 404, { requestId });

  if (desejados.length > 0) {
    const { data: membros, error: membrosErr } = await admin
      .from("user_organizations")
      .select("user_id, role")
      .eq("organization_id", org.orgId)
      .in("user_id", desejados)
      .is("revoked_at", null);
    if (membrosErr) return fail("internal_error", membrosErr.message, 500, { requestId });
    const aptos = new Set(
      (membros ?? [])
        .filter((m: { user_id: string; role: string }) => m.role !== "viewer")
        .map((m: { user_id: string }) => m.user_id),
    );
    const recusados = desejados.filter((u) => !aptos.has(u));
    if (recusados.length > 0) {
      return fail(
        "unprocessable_entity",
        t("Só atendentes ativos desta organização podem entrar num setor."),
        422,
        { requestId, details: { user_ids: recusados } },
      );
    }
  }

  const supabase = await createClient();
  if (desejados.length > 0) {
    const { error: insErr } = await supabase
      .from("sector_members")
      .upsert(
        desejados.map((user_id) => ({ organization_id: org.orgId, sector_id: id, user_id })),
        { onConflict: "sector_id,user_id", ignoreDuplicates: true },
      );
    if (insErr) return fail("internal_error", insErr.message, 500, { requestId });
  }
  let remover = supabase.from("sector_members").delete().eq("organization_id", org.orgId).eq("sector_id", id);
  if (desejados.length > 0) {
    remover = remover.not("user_id", "in", `(${desejados.join(",")})`);
  }
  const { error: delErr } = await remover;
  if (delErr) return fail("internal_error", delErr.message, 500, { requestId });

  void audit({
    action: "sector.members_changed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "sector",
    resourceId: id,
    requestId,
    metadata: { user_ids: desejados },
  });
  return ok({ sector_id: id, members: desejados }, { requestId });
}
