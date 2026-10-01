/**
 * O estado de UM destino numa ocorrência, como o Calendário mostra: cada chip
 * é (ocorrência × destino), e o Instagram pode ter saído enquanto o Facebook
 * falhou na mesma data. A ocorrência só tem o rollup; aqui se olha para as
 * execuções daquele destino.
 *
 *  - `programado`: ainda vai sair (sem execução, na fila, enviando, ou falhou
 *    de forma transitória com nova tentativa marcada);
 *  - `concluido`: toda unidade (grupo, arquivo) saiu;
 *  - `falhou`: alguma unidade falhou sem nova tentativa, ou a data foi pulada;
 *  - `cancelado`: a data foi cancelada antes de sair.
 *
 * Vale a TENTATIVA mais recente de cada unidade — uma falha que o retry
 * consertou não pinta o chip de vermelho.
 */
import type { StatusDaExecucao, StatusDaOcorrencia } from "./schema";

export const ESTADOS_DO_DESTINO = ["programado", "concluido", "falhou", "cancelado"] as const;
export type EstadoDoDestino = (typeof ESTADOS_DO_DESTINO)[number];

export interface ExecucaoParaEstado {
  target_id: string;
  group_id: string | null;
  media_id: string | null;
  attempt: number;
  status: StatusDaExecucao;
  retry_at: string | null;
}

/** Sem execução nenhuma do destino: o estado vem da própria ocorrência. */
function peloStatusDaOcorrencia(status: StatusDaOcorrencia): EstadoDoDestino {
  switch (status) {
    case "pending":
    case "processing":
      return "programado";
    case "done":
      return "concluido";
    case "cancelled":
      return "cancelado";
    case "failed":
    case "partial":
    case "skipped":
    default:
      return "falhou";
  }
}

export function estadoDoDestino(statusDaOcorrencia: StatusDaOcorrencia, execucoes: ExecucaoParaEstado[]): EstadoDoDestino {
  if (execucoes.length === 0) return peloStatusDaOcorrencia(statusDaOcorrencia);
  const ultimaPorUnidade = new Map<string, ExecucaoParaEstado>();
  for (const e of execucoes) {
    const unidade = `${e.group_id ?? ""}/${e.media_id ?? ""}`;
    const atual = ultimaPorUnidade.get(unidade);
    if (!atual || e.attempt > atual.attempt) ultimaPorUnidade.set(unidade, e);
  }
  const ultimas = [...ultimaPorUnidade.values()];
  if (ultimas.some((e) => e.status === "pending" || e.status === "sending" || (e.status === "failed" && e.retry_at !== null))) return "programado";
  if (ultimas.some((e) => e.status === "failed" || e.status === "skipped")) return "falhou";
  if (ultimas.every((e) => e.status === "cancelled")) return "cancelado";
  if (ultimas.every((e) => e.status === "sent" || e.status === "cancelled")) return "concluido";
  return peloStatusDaOcorrencia(statusDaOcorrencia);
}

/** O estado de cada destino da ocorrência, por id de destino. */
export function estadosDosDestinos(
  statusDaOcorrencia: StatusDaOcorrencia,
  targetIds: string[],
  execucoes: ExecucaoParaEstado[],
): Record<string, EstadoDoDestino> {
  const saida: Record<string, EstadoDoDestino> = {};
  for (const id of targetIds) saida[id] = estadoDoDestino(statusDaOcorrencia, execucoes.filter((e) => e.target_id === id));
  return saida;
}
