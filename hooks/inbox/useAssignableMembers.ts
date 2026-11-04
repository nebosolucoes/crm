"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface AssignableMember {
  user_id: string;
  role: string;
  full_name: string | null;
  /**
   * Se quem pede pode transferir para esta pessoa (atendente em setor: só quem
   * divide um setor com ele). Opcional: cache gravado antes deste campo existir.
   */
  pode_receber?: boolean;
}

/** G3-01: destinos válidos de transferência (membros ativos agent+ da org). */
export function useAssignableMembers(enabled: boolean) {
  return useQuery({
    queryKey: ["team", "assignable"],
    queryFn: async () => apiClient.get<{ data: AssignableMember[] }>("/api/v1/team/assignable"),
    enabled,
    staleTime: 60_000,
    select: (res) => res.data,
  });
}
