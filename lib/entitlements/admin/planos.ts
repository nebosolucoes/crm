/**
 * Leitura e escrita do CATÁLOGO de planos, para as rotas de `/api/v1/admin`.
 *
 * Service role de propósito: o catálogo é da instalação, não de um tenant, e
 * quem chama já passou por `requirePlatformAdminApi`. A ATRIBUIÇÃO a uma
 * organização e os overrides NÃO passam por aqui — vão pelas funções SQL
 * (`fn_definir_plano_da_organizacao`, `fn_criar/revogar_override_de_recurso`),
 * que conferem o `p_actor` no banco; ver `organizacoes.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerLimites, type Limites } from "../limites";
import { ehRecursoVendavel, type RecursoVendavel } from "../recursos";
import type { PlanoCriar, PlanoEditar } from "./schemas";

export interface PlanoDoCatalogo {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_default: boolean;
  limits: Limites;
  features: RecursoVendavel[];
  /** Quantas organizações estão neste plano — o que impede apagar e informa desativar. */
  organizations_count: number;
  created_at: string;
  updated_at: string;
}

interface LinhaDePlano {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_default: boolean;
  limits: unknown;
  created_at: string;
  updated_at: string;
}

async function montar(admin: SupabaseClient, linhas: LinhaDePlano[]): Promise<PlanoDoCatalogo[]> {
  if (linhas.length === 0) return [];
  const ids = linhas.map((l) => l.id);
  const [{ data: feats, error: e1 }, { data: orgs, error: e2 }] = await Promise.all([
    admin.from("platform_plan_features").select("plan_id, feature").in("plan_id", ids),
    admin.from("organizations").select("plan_id").in("plan_id", ids),
  ]);
  if (e1) throw new Error(`platform_plan_features: ${e1.message}`);
  if (e2) throw new Error(`organizations: ${e2.message}`);
  const porPlano = new Map<string, RecursoVendavel[]>();
  for (const f of (feats ?? []) as Array<{ plan_id: string; feature: string }>) {
    if (!ehRecursoVendavel(f.feature)) continue;
    porPlano.set(f.plan_id, [...(porPlano.get(f.plan_id) ?? []), f.feature]);
  }
  const contagem = new Map<string, number>();
  for (const o of (orgs ?? []) as Array<{ plan_id: string | null }>) {
    if (o.plan_id) contagem.set(o.plan_id, (contagem.get(o.plan_id) ?? 0) + 1);
  }
  return linhas.map((l) => ({
    id: l.id,
    slug: String(l.slug),
    name: l.name,
    description: l.description,
    is_active: l.is_active,
    is_default: l.is_default,
    limits: lerLimites(l.limits),
    features: (porPlano.get(l.id) ?? []).sort(),
    organizations_count: contagem.get(l.id) ?? 0,
    created_at: l.created_at,
    updated_at: l.updated_at,
  }));
}

const COLUNAS = "id, slug, name, description, is_active, is_default, limits, created_at, updated_at";

export async function listarPlanos(admin: SupabaseClient): Promise<PlanoDoCatalogo[]> {
  const { data, error } = await admin
    .from("platform_plans")
    .select(COLUNAS)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`platform_plans: ${error.message}`);
  return montar(admin, (data ?? []) as LinhaDePlano[]);
}

export async function lerPlano(admin: SupabaseClient, id: string): Promise<PlanoDoCatalogo | null> {
  const { data, error } = await admin.from("platform_plans").select(COLUNAS).eq("id", id).maybeSingle();
  if (error) throw new Error(`platform_plans: ${error.message}`);
  if (!data) return null;
  return (await montar(admin, [data as LinhaDePlano]))[0] ?? null;
}

/** Só um padrão: quem vira padrão tira o anterior — na mesma passagem. */
async function tirarPadraoDosOutros(admin: SupabaseClient, exceto: string | null): Promise<void> {
  let q = admin.from("platform_plans").update({ is_default: false }).eq("is_default", true);
  if (exceto) q = q.neq("id", exceto);
  const { error } = await q;
  if (error) throw new Error(`platform_plans (padrão): ${error.message}`);
}

async function gravarFeatures(admin: SupabaseClient, planId: string, features: RecursoVendavel[]): Promise<void> {
  const { error: e1 } = await admin.from("platform_plan_features").delete().eq("plan_id", planId);
  if (e1) throw new Error(`platform_plan_features (limpar): ${e1.message}`);
  if (features.length === 0) return;
  const { error: e2 } = await admin
    .from("platform_plan_features")
    .insert(features.map((feature) => ({ plan_id: planId, feature })));
  if (e2) throw new Error(`platform_plan_features (gravar): ${e2.message}`);
}

export type ResultadoDeEscrita<T> =
  | { ok: true; plano: T }
  | { ok: false; codigo: "slug_em_uso" | "nao_encontrado" | "padrao_inativo" | "sem_padrao" };

export async function criarPlano(
  admin: SupabaseClient,
  actorId: string,
  entrada: PlanoCriar,
): Promise<ResultadoDeEscrita<PlanoDoCatalogo>> {
  if (entrada.is_default && entrada.is_active === false) return { ok: false, codigo: "padrao_inativo" };
  if (entrada.is_default) await tirarPadraoDosOutros(admin, null);
  const { data, error } = await admin
    .from("platform_plans")
    .insert({
      slug: entrada.slug,
      name: entrada.name,
      description: entrada.description ?? null,
      is_active: entrada.is_active ?? true,
      is_default: entrada.is_default ?? false,
      limits: entrada.limits ?? {},
      created_by: actorId,
      updated_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, codigo: "slug_em_uso" };
    throw new Error(`platform_plans (criar): ${error.message}`);
  }
  await gravarFeatures(admin, data.id as string, entrada.features);
  const plano = await lerPlano(admin, data.id as string);
  return { ok: true, plano: plano! };
}

export async function editarPlano(
  admin: SupabaseClient,
  actorId: string,
  id: string,
  entrada: PlanoEditar,
): Promise<ResultadoDeEscrita<{ antes: PlanoDoCatalogo; depois: PlanoDoCatalogo }>> {
  const antes = await lerPlano(admin, id);
  if (!antes) return { ok: false, codigo: "nao_encontrado" };
  const ativoDepois = entrada.is_active ?? antes.is_active;
  const padraoDepois = entrada.is_default ?? antes.is_default;
  if (padraoDepois && !ativoDepois) return { ok: false, codigo: "padrao_inativo" };
  // Tirar o padrão sem pôr outro deixaria toda organização nova só com Canais.
  // O caminho é marcar OUTRO plano como padrão — que tira este na mesma passagem.
  if (entrada.is_default === false && antes.is_default) return { ok: false, codigo: "sem_padrao" };

  if (entrada.is_default === true && !antes.is_default) await tirarPadraoDosOutros(admin, id);
  const patch: Record<string, unknown> = { updated_by: actorId };
  if (entrada.name !== undefined) patch.name = entrada.name;
  if (entrada.description !== undefined) patch.description = entrada.description;
  if (entrada.limits !== undefined) patch.limits = entrada.limits;
  if (entrada.is_active !== undefined) patch.is_active = entrada.is_active;
  if (entrada.is_default !== undefined) patch.is_default = entrada.is_default;
  const { error } = await admin.from("platform_plans").update(patch).eq("id", id);
  if (error) throw new Error(`platform_plans (editar): ${error.message}`);
  if (entrada.features !== undefined) await gravarFeatures(admin, id, entrada.features);
  const depois = await lerPlano(admin, id);
  return { ok: true, plano: { antes, depois: depois! } };
}
