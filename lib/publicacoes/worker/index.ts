/**
 * O tick do worker de Publicações — chamado a cada minuto pelo scheduler
 * (`app/api/v1/cron/publications-worker`) e pelo relógio HTTP das instalações
 * sem scheduler (`lib/relogio/tarefas.ts`).
 *
 * Quatro passos, sempre nesta ordem, com um orçamento de tempo
 * (`ORCAMENTO_DO_TICK_MS`): o que não couber fica para o próximo minuto.
 *
 *   1. materializar — a recorrência gera as ocorrências até o horizonte;
 *   2. expandir     — ocorrência vencida vira execuções (ou é pulada);
 *   3. executar     — claim por (ocorrência, destino) e publicação em ordem;
 *   4. reconciliar  — o que ficou em `sending` sem notícia.
 *
 * Tudo aqui é idempotente por construção: cada passo é guardado por status,
 * lease ou constraint única, e um tick sobreposto encontra as portas fechadas.
 */
import { randomUUID } from "node:crypto";

import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

import { ORCAMENTO_DO_TICK_MS } from "../politica";
import { materializarRecorrencia } from "../servico";
import type { TipoDeRecorrencia } from "../schema";
import { executarExecucoesArrendadas } from "./executar";
import { expandirOcorrenciasVencidas } from "./expandir";
import { reconciliarExecucoesPresas } from "./reconciliar";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ResultadoDoWorkerDePublicacoes {
  materialized: number;
  expanded: number;
  executions_created: number;
  retries_created: number;
  skipped: number;
  claimed: number;
  sent: number;
  accepted: number;
  failed: number;
  reconciled: number;
  timed_out: number;
  /** Houve algum efeito (para o cron auditar só quando fez algo). */
  teve_efeito: boolean;
}

export interface OpcoesDoWorker {
  orcamentoMs?: number;
  limitePorPasso?: number;
  esperar?: (ms: number) => Promise<void>;
}

async function materializarRecorrencias(admin: AdminClient, agora: Date, limite: number): Promise<number> {
  const { data, error } = await admin
    .from("publications")
    .select("id, organization_id, timezone, recurrence_kind, recurrence_config, repeat_until, max_occurrences")
    .eq("status", "scheduled")
    .neq("recurrence_kind", "none")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(limite);
  if (error) throw new Error(`publicacoes_recurrence_query_failed: ${error.message}`);
  let total = 0;
  for (const p of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    try {
      total += await materializarRecorrencia(
        admin,
        {
          id: p.id as string,
          organization_id: p.organization_id as string,
          timezone: p.timezone as string,
          recurrence_kind: p.recurrence_kind as TipoDeRecorrencia,
          recurrence_config: (p.recurrence_config as Record<string, unknown>) ?? {},
          repeat_until: (p.repeat_until as string | null) ?? null,
          max_occurrences: (p.max_occurrences as number | null) ?? null,
        },
        agora,
      );
    } catch (err) {
      logger.error("[publicacoes] materializar recorrência falhou", { publication_id: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return total;
}

export async function executarWorkerDePublicacoes(
  admin: AdminClient,
  agora: Date,
  requestId: string,
  opcoes: OpcoesDoWorker = {},
): Promise<ResultadoDoWorkerDePublicacoes> {
  const inicio = Date.now();
  const prazo = inicio + (opcoes.orcamentoMs ?? ORCAMENTO_DO_TICK_MS);
  const limite = opcoes.limitePorPasso ?? 100;
  const workerId = `${requestId}:${randomUUID()}`;

  const materialized = await materializarRecorrencias(admin, agora, limite);
  const expansao = await expandirOcorrenciasVencidas(admin, agora, requestId, limite);

  let claimed = 0;
  let sent = 0;
  let accepted = 0;
  let failed = 0;
  // Roda claims até esvaziar a fila ou estourar o orçamento.
  for (let rodada = 0; rodada < 20 && Date.now() < prazo; rodada += 1) {
    const r = await executarExecucoesArrendadas(admin, agora, requestId, {
      limite: 20,
      prazoMs: prazo,
      workerId,
      esperar: opcoes.esperar,
    });
    claimed += r.claimed;
    sent += r.sent;
    accepted += r.accepted;
    failed += r.failed;
    if (r.claimed === 0) break;
  }

  const rec = await reconciliarExecucoesPresas(admin, agora, requestId);

  const resultado: ResultadoDoWorkerDePublicacoes = {
    materialized,
    expanded: expansao.expanded,
    executions_created: expansao.executions,
    retries_created: expansao.retries,
    skipped: expansao.skipped,
    claimed,
    sent,
    accepted,
    failed,
    reconciled: rec.reconciled,
    timed_out: rec.timed_out,
    teve_efeito: false,
  };
  resultado.teve_efeito =
    resultado.expanded + resultado.skipped + resultado.sent + resultado.accepted + resultado.failed + resultado.reconciled + resultado.timed_out + resultado.retries_created > 0;
  return resultado;
}
