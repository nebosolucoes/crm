"use client";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { apiClient } from "@/lib/api/client";

export interface ConversationCounts {
  /**
   * OPCIONAIS de propósito: um cache de react-query gravado antes deste deploy
   * não tem estes campos, e a tela lê o cache antes da primeira resposta nova.
   * Marcá-los obrigatórios daria `undefined` onde o tipo promete `number` — e o
   * badge imprimiria "NaN" no primeiro segundo depois de atualizar.
   */
  fila?: number;
  automatico?: number;
  /** Nome antigo de `fila`, mantido pela rota versionada. Prefira `fila`. */
  unassigned: number;
  mine: number;
  all: number;
  /** Opcional pelo mesmo motivo dos de cima: cache gravado antes deste deploy não tem. */
  closed?: number;
  /** A aba "Arquivadas" (#923). Opcional pelo mesmo motivo: cache antigo não tem. */
  archived?: number;
}

/** Os filtros auxiliares ligados na barra, que a contagem tem de aplicar junto. */
export interface FiltrosDaContagem {
  unread?: boolean;
  tag?: string;
  channel_session_id?: string;
  sector_id?: string;
  /** Spec 22: `direct` ou `comment`. */
  kind?: string;
}

export const INTERVALO_DA_CONTAGEM_MS = 30_000;
export const TETO_DO_RECUO_DA_CONTAGEM_MS = 5 * 60_000;

/**
 * De quanto em quanto tempo recontar, dado quantos erros SEGUIDOS houve. Com o
 * banco sob statement timeout (03/11/2026: 460 erros em 36 h), recontar a cada
 * 30 s em toda aba aberta só somava carga: dobra a cada erro, até 5 min. Pura.
 */
export function intervaloDaContagem(errosSeguidos: number): number {
  if (errosSeguidos <= 0) return INTERVALO_DA_CONTAGEM_MS;
  return Math.min(INTERVALO_DA_CONTAGEM_MS * 2 ** errosSeguidos, TETO_DO_RECUO_DA_CONTAGEM_MS);
}

/**
 * Contagens por visão do inbox (G4-02). O endpoint usa o client RLS-scoped —
 * um agent em modo own* recebe a contagem do seu escopo, não o total da org.
 */
export function useConversationCounts(
  orgId: string | null,
  filtros: FiltrosDaContagem = {},
) {
  const qs = new URLSearchParams();
  if (filtros.unread) qs.set("unread", "true");
  if (filtros.tag) qs.set("tag", filtros.tag);
  if (filtros.channel_session_id) qs.set("channel_session_id", filtros.channel_session_id);
  if (filtros.sector_id) qs.set("sector_id", filtros.sector_id);
  if (filtros.kind) qs.set("kind", filtros.kind);
  const sufixo = qs.toString();
  // `errorUpdateCount` só cresce; os erros SEGUIDOS são a diferença para o
  // valor que ele tinha no último sucesso.
  const errosNoUltimoSucesso = useRef(0);

  return useQuery({
    // ⚠️ OS FILTROS ENTRAM NA CHAVE. Sem isso o react-query devolveria a contagem
    // guardada para OUTRO conjunto de filtros, sem ir ao servidor — e o badge
    // voltaria a mentir, agora pelo cache. Seria o mesmo defeito por outra porta.
    queryKey: ["conversation-counts", orgId, sufixo],
    enabled: !!orgId,
    refetchInterval: (query) => {
      if (query.state.status !== "error") {
        errosNoUltimoSucesso.current = query.state.errorUpdateCount;
        return INTERVALO_DA_CONTAGEM_MS;
      }
      return intervaloDaContagem(query.state.errorUpdateCount - errosNoUltimoSucesso.current);
    },
    queryFn: () =>
      apiClient
        .get<{ data: ConversationCounts }>(
          `/api/v1/conversations/counts${sufixo ? `?${sufixo}` : ""}`,
        )
        .then((r) => r.data),
  });
}
