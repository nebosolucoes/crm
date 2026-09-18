/**
 * O que o platform admin faz COM UMA ORGANIZAÇÃO: atribuir plano, liberar ou
 * bloquear um recurso, revogar. Tudo por RPC — as funções SQL conferem o
 * `p_actor` (platform admin `full`) e são o único caminho de escrita de
 * `organizations.plan_id` (trigger de guarda). Cada mudança:
 *
 *   1. audita (`tenant.plan_changed`, `tenant.feature_override_*`) — quem, o
 *      quê, de/para, motivo;
 *   2. avisa a ORGANIZAÇÃO na Central (`entitlement_changed`, severity info):
 *      o admin do cliente vê "seu plano mudou" e "IA liberada até dd/mm" sem
 *      ninguém precisar mandar e-mail;
 *   3. esquece a memória do worker? Não dá daqui (outro processo); ele relê em
 *      60 s (`resolver-pg.ts`), e a API relê no próximo request.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";

import { consumoDaOrg, type Medicao } from "../consumo";
import { lerLimites, type Limites } from "../limites";
import { ROTULO_DO_RECURSO, ehRecurso, type Recurso } from "../recursos";
import { lerEntitlements, type Entitlements, type ModoDeOverride } from "../tipos";
import { KIND_DO_AVISO } from "../aviso-na-central";
import type { OverrideCriar } from "./schemas";

export interface OverrideDaOrganizacao {
  id: string;
  feature: Recurso;
  mode: ModoDeOverride;
  limits: Limites;
  starts_at: string;
  ends_at: string | null;
  reason: string;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  /** Derivado: vale AGORA (não revogado, janela aberta). */
  ativo: boolean;
}

export interface VisaoDeEntitlements {
  organization_id: string;
  plan_id: string | null;
  plan_assigned_at: string | null;
  efetivo: Entitlements;
  /** TODOS os overrides, inclusive vencidos e revogados — a tela conta a história. */
  overrides: OverrideDaOrganizacao[];
  /** Cada limite com teto, uso e se barra (etapa 8). */
  consumo: Medicao[];
}

export async function visaoDeEntitlements(admin: SupabaseClient, orgId: string): Promise<VisaoDeEntitlements | null> {
  const [{ data: org, error: e1 }, { data: efetivo, error: e2 }, { data: ovs, error: e3 }] = await Promise.all([
    admin.from("organizations").select("id, plan_id, plan_assigned_at").eq("id", orgId).maybeSingle(),
    admin.rpc("fn_org_entitlements", { p_org: orgId }),
    admin
      .from("organization_feature_overrides")
      .select("id, feature, mode, limits, starts_at, ends_at, reason, created_by, created_at, revoked_at, revoked_by, revoke_reason")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  ]);
  if (e1) throw new Error(`organizations: ${e1.message}`);
  if (!org) return null;
  if (e2) throw new Error(`fn_org_entitlements: ${e2.message}`);
  if (e3) throw new Error(`organization_feature_overrides: ${e3.message}`);
  const agora = Date.now();
  const overrides: OverrideDaOrganizacao[] = [];
  for (const o of (ovs ?? []) as Array<Record<string, unknown>>) {
    if (!ehRecurso(o.feature)) continue;
    const starts = new Date(String(o.starts_at)).getTime();
    const ends = o.ends_at ? new Date(String(o.ends_at)).getTime() : null;
    overrides.push({
      id: String(o.id),
      feature: o.feature,
      mode: o.mode as ModoDeOverride,
      limits: lerLimites(o.limits),
      starts_at: String(o.starts_at),
      ends_at: o.ends_at ? String(o.ends_at) : null,
      reason: String(o.reason ?? ""),
      created_by: (o.created_by as string | null) ?? null,
      created_at: String(o.created_at),
      revoked_at: (o.revoked_at as string | null) ?? null,
      revoked_by: (o.revoked_by as string | null) ?? null,
      revoke_reason: (o.revoke_reason as string | null) ?? null,
      ativo: !o.revoked_at && starts <= agora && (ends === null || ends > agora),
    });
  }
  const lido = lerEntitlements(efetivo);
  return {
    organization_id: orgId,
    plan_id: (org.plan_id as string | null) ?? null,
    plan_assigned_at: (org.plan_assigned_at as string | null) ?? null,
    efetivo: lido,
    overrides,
    consumo: await consumoDaOrg(admin, orgId, lido.limits),
  };
}

async function avisarOrganizacao(admin: SupabaseClient, orgId: string, title: string, body: string): Promise<void> {
  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: orgId,
    kind: KIND_DO_AVISO,
    severity: "info",
    title,
    body,
    ref_kind: "organization",
    ref_id: orgId,
  });
  // Best-effort: o audit é o registro; o aviso é cortesia com o cliente.
  if (error) logger.error("[entitlements] aviso na Central não gravado", { organization_id: orgId, message: error.message });
}

export type ResultadoRpc<T> = { ok: true; valor: T } | { ok: false; codigo: string; mensagem: string };

function traduzirErroRpc(message: string): { codigo: string; mensagem: string } {
  if (message.includes("plan_inactive")) return { codigo: "plan_inactive", mensagem: "Plano fora de circulação: não pode receber organização." };
  if (message.includes("plan_not_found")) return { codigo: "not_found", mensagem: "Plano não encontrado." };
  if (message.includes("organization_not_found")) return { codigo: "not_found", mensagem: "Organização não encontrada." };
  if (message.includes("platform_admin_required")) return { codigo: "forbidden", mensagem: "Platform admin com escopo total é exigido." };
  if (message.includes("ofo_canais_nunca_desligam")) return { codigo: "validation_failed", mensagem: "Canais nunca pode ser desligado." };
  if (message.includes("ofo_janela_check")) return { codigo: "validation_failed", mensagem: "O fim tem de ser depois do início." };
  return { codigo: "internal_error", mensagem: message };
}

export async function atribuirPlano(
  admin: SupabaseClient,
  actorId: string,
  orgId: string,
  planId: string,
  reason: string,
  requestId: string,
): Promise<ResultadoRpc<{ changed: boolean; from_plan_id: string | null; to_plan_id: string }>> {
  const { data, error } = await admin.rpc("fn_definir_plano_da_organizacao", {
    p_actor: actorId,
    p_org: orgId,
    p_plan: planId,
    p_reason: reason,
  });
  if (error) return { ok: false, ...traduzirErroRpc(error.message) };
  const r = data as { changed: boolean; from_plan_id: string | null; to_plan_id: string };
  if (r.changed) {
    const [{ data: de }, { data: para }] = await Promise.all([
      r.from_plan_id ? admin.from("platform_plans").select("slug, name").eq("id", r.from_plan_id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from("platform_plans").select("slug, name").eq("id", r.to_plan_id).maybeSingle(),
    ]);
    void audit({
      action: "tenant.plan_changed",
      actorUserId: actorId,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      organizationId: orgId,
      resourceType: "organization",
      resourceId: orgId,
      requestId,
      metadata: { from_plan: de?.slug ?? null, to_plan: para?.slug ?? null, from_plan_id: r.from_plan_id, to_plan_id: r.to_plan_id, reason },
    });
    await avisarOrganizacao(
      admin,
      orgId,
      "O plano da sua organização mudou",
      `Sua organização agora está no plano ${para?.name ?? "novo"}. Veja em Configurações › Billing o que está incluído.`,
    );
  }
  return { ok: true, valor: r };
}

export async function criarOverride(
  admin: SupabaseClient,
  actorId: string,
  orgId: string,
  entrada: OverrideCriar,
  requestId: string,
): Promise<ResultadoRpc<{ id: string }>> {
  const { data, error } = await admin.rpc("fn_criar_override_de_recurso", {
    p_actor: actorId,
    p_org: orgId,
    p_feature: entrada.feature,
    p_mode: entrada.mode,
    p_starts_at: entrada.starts_at ?? null,
    p_ends_at: entrada.ends_at ?? null,
    p_limits: entrada.limits ?? {},
    p_reason: entrada.reason,
  });
  if (error) return { ok: false, ...traduzirErroRpc(error.message) };
  const id = String(data);
  void audit({
    action: "tenant.feature_override_created",
    actorUserId: actorId,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: orgId,
    resourceType: "organization_feature_overrides",
    resourceId: id,
    requestId,
    metadata: {
      feature: entrada.feature,
      mode: entrada.mode,
      starts_at: entrada.starts_at ?? null,
      ends_at: entrada.ends_at ?? null,
      limits: entrada.limits ?? {},
      reason: entrada.reason,
    },
  });
  const rotulo = ROTULO_DO_RECURSO[entrada.feature];
  // Data ISO (AAAA-MM-DD): o corpo vai para a Central de uma organização cujo
  // idioma este servidor não escolhe — e a tela de Billing mostra a data no
  // idioma da pessoa a partir do `ends_at`, não deste texto.
  const ate = entrada.ends_at ? ` até ${entrada.ends_at.slice(0, 10)}` : "";
  await avisarOrganizacao(
    admin,
    orgId,
    entrada.mode === "enable" ? `${rotulo} foi liberado para a sua organização` : `${rotulo} foi bloqueado para a sua organização`,
    entrada.mode === "enable"
      ? `${rotulo} está disponível${ate}. Veja em Configurações › Billing.`
      : `${rotulo} deixou de estar disponível${ate}. Veja em Configurações › Billing.`,
  );
  return { ok: true, valor: { id } };
}

export async function revogarOverride(
  admin: SupabaseClient,
  actorId: string,
  orgId: string,
  overrideId: string,
  reason: string,
  requestId: string,
): Promise<ResultadoRpc<{ revoked: boolean }>> {
  const { data, error } = await admin.rpc("fn_revogar_override_de_recurso", {
    p_actor: actorId,
    p_org: orgId,
    p_override: overrideId,
    p_reason: reason,
  });
  if (error) return { ok: false, ...traduzirErroRpc(error.message) };
  const revoked = data === true;
  if (revoked) {
    void audit({
      action: "tenant.feature_override_revoked",
      actorUserId: actorId,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      organizationId: orgId,
      resourceType: "organization_feature_overrides",
      resourceId: overrideId,
      requestId,
      metadata: { reason },
    });
    await avisarOrganizacao(
      admin,
      orgId,
      "Uma liberação especial da sua organização foi encerrada",
      "Um recurso liberado fora do plano voltou às regras do plano. Veja em Configurações › Billing.",
    );
  }
  return { ok: true, valor: { revoked } };
}
