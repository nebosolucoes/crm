import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * /api/v1/sectors — os SETORES de atendimento da organização (spec 20 §2, §4).
 *
 * GET  agent+   lista os setores (ativos e inativos) com os membros de cada um.
 *               Todo membro precisa ler: é a lista que a tela de transferir
 *               oferece. A RLS de `sectors`/`sector_members` já é por
 *               organização; o client de sessão herda.
 * POST manager+ cria. Barra pelo limite `max_sectors` do plano ANTES de gravar
 *               (`recusaPorLimite`), deriva o `slug` do nome quando não vem, e
 *               devolve 409 quando o slug já existe na organização.
 *
 * Escrita pelo client de SESSÃO de propósito: a policy `tenant_isolation_sectors_write`
 * exige manager+, e `requireRole` já exigiu — as duas camadas concordam.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { recusaPorLimite } from "@/lib/entitlements/exigir-na-rota";
import { traduzir } from "@/lib/i18n/dicionario";
import { createSectorSchema } from "@/lib/schemas/setores";
import { achatarMembros, type LinhaComMembros, SECTOR_COLUMNS, SECTOR_COLUMNS_COM_MEMBROS } from "@/lib/setores/colunas";
import { slugDoSetor } from "@/lib/setores/vocabulario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { feature: "inbox", requestId, resource: "sectors" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sectors")
    .select(SECTOR_COLUMNS_COM_MEMBROS)
    .eq("organization_id", authz.org.orgId)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok((data ?? []).map((l) => achatarMembros(l as LinhaComMembros)), { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "inbox", requestId, resource: "sectors" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  const raw = await req.json().catch(() => null);
  const parsed = createSectorSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const input = parsed.data;
  const slug = input.slug ?? slugDoSetor(input.name);
  if (!slug) {
    return fail("validation_failed", t("O nome precisa ter ao menos uma letra ou número."), 422, {
      requestId,
      details: { name: ["sem caracteres válidos para o identificador"] },
    });
  }

  // Limite do plano: o teto de setores barra antes de gravar (spec 20 §2.3).
  const noTeto = await recusaPorLimite(org.orgId, "max_sectors", {
    admin: createAdminClient(),
    requestId,
    resource: "sectors",
    actorUserId: user.id,
  });
  if (noTeto) return noTeto;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sectors")
    .insert({
      organization_id: org.orgId,
      name: input.name,
      slug,
      description: input.description,
      scope: input.scope,
      created_by: user.id,
    })
    .select(SECTOR_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return fail("state_conflict", t("Já existe um setor com este identificador."), 409, {
        requestId,
        details: { slug },
      });
    }
    return fail("internal_error", error?.message ?? "insert_failed", 500, { requestId });
  }

  void audit({
    action: "sector.created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "sector",
    resourceId: data.id,
    requestId,
    metadata: { name: data.name, slug: data.slug, scope: data.scope },
  });
  return ok({ ...data, members: [] }, { requestId, status: 201 });
}
