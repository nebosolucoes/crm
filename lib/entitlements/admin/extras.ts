/**
 * Conexões extras por empresa (migration 0281, spec 21 §10) — o lado do admin
 * da instalação: listar, vender (+N) e encerrar.
 *
 * O extra SOMA ao teto do plano (ou do override) — a conta mora em
 * `lib/entitlements/consumo.ts`. Aqui só se grava e se audita. Escrita pelo
 * service role, com a organização vinda do PATH da rota do admin (nunca do
 * corpo) e `organization_id` sempre no filtro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { audit } from "@/lib/audit";

import { CHAVES_COM_EXTRA, type ChaveComExtra } from "../limites";

export const extraCriarSchema = z.object({
  limit_key: z.enum(CHAVES_COM_EXTRA),
  quantidade: z.number().int().min(1).max(1000),
  reason: z.string().trim().min(3).max(500),
});
export type ExtraCriar = z.infer<typeof extraCriarSchema>;

export interface ExtraDaOrganizacao {
  id: string;
  limit_key: ChaveComExtra;
  quantidade: number;
  reason: string;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function listarExtras(admin: SupabaseClient, orgId: string): Promise<ExtraDaOrganizacao[]> {
  const { data, error } = await admin
    .from("organization_limit_extras")
    .select("id, limit_key, quantidade, reason, created_by, created_at, revoked_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`organization_limit_extras: ${error.message}`);
  return ((data ?? []) as ExtraDaOrganizacao[]).filter((e) =>
    (CHAVES_COM_EXTRA as readonly string[]).includes(e.limit_key),
  );
}

export async function criarExtra(
  admin: SupabaseClient,
  input: { actorId: string; orgId: string; extra: ExtraCriar; requestId: string },
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const { data, error } = await admin
    .from("organization_limit_extras")
    .insert({
      organization_id: input.orgId,
      limit_key: input.extra.limit_key,
      quantidade: input.extra.quantidade,
      reason: input.extra.reason,
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, motivo: error?.message ?? "sem id" };
  void audit({
    action: "tenant.limit_extra_added",
    actorUserId: input.actorId,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: input.orgId,
    resourceType: "organization_limit_extras",
    resourceId: data.id as string,
    requestId: input.requestId,
    metadata: { limit_key: input.extra.limit_key, quantidade: input.extra.quantidade, reason: input.extra.reason },
  });
  return { ok: true, id: data.id as string };
}

export async function revogarExtra(
  admin: SupabaseClient,
  input: { actorId: string; orgId: string; extraId: string; requestId: string },
): Promise<boolean> {
  const { data, error } = await admin
    .from("organization_limit_extras")
    .update({ revoked_at: new Date().toISOString(), revoked_by: input.actorId })
    .eq("organization_id", input.orgId)
    .eq("id", input.extraId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`organization_limit_extras: ${error.message}`);
  const revogado = (data ?? []).length > 0;
  if (revogado) {
    void audit({
      action: "tenant.limit_extra_revoked",
      actorUserId: input.actorId,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      organizationId: input.orgId,
      resourceType: "organization_limit_extras",
      resourceId: input.extraId,
      requestId: input.requestId,
    });
  }
  return revogado;
}
