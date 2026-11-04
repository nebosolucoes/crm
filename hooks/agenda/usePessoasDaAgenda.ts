"use client";

import { useQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { trilhasDaEquipe } from "@/lib/agenda/tipos";
import { apiClient } from "@/lib/api/client";

import type { Pessoa } from "@/components/agenda/tipos";

interface MembroDto {
  user_id: string;
  full_name: string | null;
  role: string;
}

/**
 * As pessoas da equipe, com a trilha de cor de cada uma.
 *
 * A FONTE é `/api/v1/team/assignable`, e não `/api/v1/team`: a agenda é usada
 * por atendentes, e `/team` exige gerente (devolve e-mail e último acesso). Um
 * atendente abria a agenda, levava 403 com aviso de erro e via a barra de
 * pessoas vazia (produção, 03/11/2026). A `assignable` é a lista mínima feita
 * para atendentes — `user_id`, nome e papel, sem dado pessoal — e já traz só
 * quem não foi revogado e não é viewer.
 *
 * A cor NÃO vem da API: vem de `trilhaPadraoDoMembro(user_id)`, que deriva do id de
 * forma estável. É por isso que a pessoa não troca de cor entre um carregamento
 * e outro, nem quando alguém novo entra na equipe — e é o motivo de este hook
 * não precisar de nenhuma coluna de cor no banco.
 */
export function usePessoasDaAgenda() {
  return useQuery({
    queryKey: ["agenda", "pessoas"],
    queryFn: async (): Promise<Pessoa[]> => {
      try {
        const r = await apiClient.get<{ data: MembroDto[] }>("/api/v1/team/assignable");
        const lista = (r as unknown as { data?: MembroDto[] }).data ?? (r as unknown as MembroDto[]);
        const ativos = lista ?? [];
        // As trilhas saem da EQUIPE inteira de uma vez, não pessoa a pessoa: é a
        // única forma de garantir que duas pessoas não caiam na mesma cor. O
        // hash sozinho dá estabilidade e não dá distinção — medido, duas caíram
        // na trilha 7 nesta organização.
        const trilhas = trilhasDaEquipe(ativos.map((m) => m.user_id));
        return ativos.map((m) => ({
          id: m.user_id,
          // `full_name` vem null quando o service role não está configurado — a
          // rota degrada assim de propósito.
          nome: m.full_name ?? "Sem nome",
          trilha: trilhas.get(m.user_id) ?? 1,
        }));
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}
