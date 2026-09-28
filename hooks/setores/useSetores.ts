"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { SectorScope } from "@/lib/setores/vocabulario";

/** Uma linha de `GET /api/v1/sectors` (spec 20): o setor com os ids dos membros. */
export interface SectorRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string;
  scope: SectorScope;
  is_active: boolean;
  members: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Os setores da organização, ativos e inativos. A chave `["sectors"]` é a que as
 * telas invalidam ao criar/editar — inbox, transferir e equipe leem daqui.
 */
export function useSetores(enabled = true) {
  return useQuery({
    queryKey: ["sectors"],
    queryFn: async () => (await apiClient.get<{ data: SectorRow[] }>("/api/v1/sectors")).data,
    enabled,
    staleTime: 60_000,
  });
}

/** Só os ativos — o que se oferece para transferir, filtrar e entregar. */
export function useSetoresAtivos(enabled = true) {
  const q = useSetores(enabled);
  return { ...q, data: q.data?.filter((s) => s.is_active) };
}
