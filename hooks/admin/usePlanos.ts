"use client";
/**
 * Leitura e escrita do catálogo de planos e do plano de UMA organização, para
 * as telas de `/admin/planos` e da aba Plano do tenant (migration 0275).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { randomId } from "@/lib/random-id";
import type { OverrideDaOrganizacao } from "@/lib/entitlements/admin/organizacoes";
import type { Medicao } from "@/lib/entitlements/consumo";
import type { PlanoDoCatalogo } from "@/lib/entitlements/admin/planos";
import type { OverrideCriar, PlanoCriar, PlanoEditar } from "@/lib/entitlements/admin/schemas";
import type { EntitlementsSerializados } from "@/lib/entitlements/tipos";

export type { PlanoDoCatalogo, OverrideDaOrganizacao };

const CHAVE_PLANOS = ["admin", "planos"] as const;
const chaveDoTenant = (id: string) => ["admin", "tenant", id, "plano"] as const;

export function usePlanos() {
  return useQuery({
    queryKey: CHAVE_PLANOS,
    queryFn: () => apiClient.get<{ data: PlanoDoCatalogo[] }>("/api/v1/admin/plans").then((r) => r.data),
    staleTime: 60 * 1000,
  });
}

export function usePlano(id: string) {
  return useQuery({
    queryKey: [...CHAVE_PLANOS, id],
    queryFn: () => apiClient.get<{ data: PlanoDoCatalogo }>(`/api/v1/admin/plans/${id}`).then((r) => r.data),
  });
}

export function useCriarPlano() {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: PlanoCriar) => apiClient.post<{ data: PlanoDoCatalogo }>("/api/v1/admin/plans", corpo).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_PLANOS });
      toast.success(t("Plano criado"));
    },
    onError: (err: Error) => toast.error(t("Não foi possível criar o plano"), { description: err.message }),
  });
}

export function useEditarPlano(id: string) {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: PlanoEditar) => apiClient.patch<{ data: PlanoDoCatalogo }>(`/api/v1/admin/plans/${id}`, corpo).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_PLANOS });
      void qc.invalidateQueries({ queryKey: ["admin", "tenant"] });
      toast.success(t("Plano salvo"));
    },
    onError: (err: Error) => toast.error(t("Não foi possível salvar o plano"), { description: err.message }),
  });
}

export interface PlanoDoTenant {
  organization_id: string;
  plan_id: string | null;
  plan_assigned_at: string | null;
  efetivo: EntitlementsSerializados;
  overrides: OverrideDaOrganizacao[];
  consumo: Medicao[];
  planos: PlanoDoCatalogo[];
}

export function usePlanoDoTenant(tenantId: string) {
  return useQuery({
    queryKey: chaveDoTenant(tenantId),
    queryFn: () => apiClient.get<{ data: PlanoDoTenant }>(`/api/v1/admin/tenants/${tenantId}/plan`).then((r) => r.data),
  });
}

export function useAtribuirPlano(tenantId: string) {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: { plan_id: string; reason: string }) =>
      apiClient.put<{ data: { changed: boolean } }>(`/api/v1/admin/tenants/${tenantId}/plan`, corpo).then((r) => r.data),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: chaveDoTenant(tenantId) });
      void qc.invalidateQueries({ queryKey: CHAVE_PLANOS });
      toast.success(r.changed ? t("Plano atribuído") : t("A organização já estava neste plano"));
    },
    onError: (err: Error) => toast.error(t("Não foi possível atribuir o plano"), { description: err.message }),
  });
}

export function useCriarOverride(tenantId: string) {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: OverrideCriar) =>
      apiClient
        .post<{ data: { id: string } }>(`/api/v1/admin/tenants/${tenantId}/overrides`, corpo, {
          idempotencyKey: randomId(),
        })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveDoTenant(tenantId) });
      toast.success(t("Liberação registrada"));
    },
    onError: (err: Error) => toast.error(t("Não foi possível registrar"), { description: err.message }),
  });
}

export function useRevogarOverride(tenantId: string) {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.delete<{ data: { revoked: boolean } }>(`/api/v1/admin/tenants/${tenantId}/overrides/${id}`, { reason }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveDoTenant(tenantId) });
      toast.success(t("Liberação encerrada"));
    },
    onError: (err: Error) => toast.error(t("Não foi possível encerrar"), { description: err.message }),
  });
}
