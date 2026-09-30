/**
 * Passo 4 do tick: o que ficou em `sending` sem notícia.
 *
 * Duas famílias:
 *  - `accepted` no provedor (há `external_post_id`): o desfecho deveria ter
 *    chegado por webhook. Passado o silêncio (`politica.ts`), perguntamos ao
 *    canal (`consultar`) e fechamos com o que ele disser. Sem resposta, fica
 *    para o próximo tick — nunca se inventa desfecho.
 *  - sem id externo (o processo caiu entre `sending` e a resposta, ou o
 *    transporte não devolve id): fecha `failed/worker_timeout`, PERMANENTE e
 *    sem reenvio. A mensagem diz quantos arquivos já tinham saído (`sent_files`),
 *    para quem lê decidir se reenvia à mão.
 */
import { getPublisher } from "@/lib/channels/publicacao";
import { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef } from "@/lib/channels/session-ref";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

import { CHAVE_DOS_ARQUIVOS_ENVIADOS } from "../schema";
import { SILENCIO_ANTES_DE_RECONCILIAR_MS } from "../politica";
import { avisarFalhaDePublicacao, rotuloDaRede, rotuloDoFormato } from "./avisos";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ResultadoDaReconciliacao {
  reconciled: number;
  timed_out: number;
}

export async function reconciliarExecucoesPresas(admin: AdminClient, agora: Date, requestId: string): Promise<ResultadoDaReconciliacao> {
  const resultado: ResultadoDaReconciliacao = { reconciled: 0, timed_out: 0 };
  const limite = new Date(agora.getTime() - SILENCIO_ANTES_DE_RECONCILIAR_MS).toISOString();
  const { data, error } = await admin
    .from("publication_executions")
    .select(
      `id, organization_id, occurrence_id, target_id, external_post_id, metadata, updated_at,
       publication_targets!publication_executions_target_org_fkey(network, format, channel_sessions!publication_targets_channel_org_fkey(provider, platform, ${CHANNEL_SESSION_REF_COLUMNS})),
       publication_occurrences!publication_executions_occurrence_org_fkey(scheduled_at),
       publications!publication_executions_publication_org_fkey(title)`,
    )
    .eq("status", "sending")
    .lte("updated_at", limite)
    .limit(100);
  if (error) throw new Error(`publicacoes_reconcile_query_failed: ${error.message}`);

  const tocadas = new Set<string>();
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const id = row.id as string;
    const orgId = row.organization_id as string;
    const occId = row.occurrence_id as string;
    const target = row.publication_targets as { network: string; format: string; channel_sessions: Record<string, unknown> | null } | null;
    const titulo = ((row.publications as { title?: string | null } | null)?.title as string | null) ?? null;
    const quando = ((row.publication_occurrences as { scheduled_at?: string } | null)?.scheduled_at as string) ?? agora.toISOString();
    const destino = target ? `${rotuloDaRede(target.network)} · ${rotuloDoFormato(target.format)}` : "destino";
    const metadata = (row.metadata as Record<string, unknown>) ?? {};
    const externalId = row.external_post_id as string | null;
    tocadas.add(occId);

    const publisher = target?.channel_sessions
      ? getPublisher(target.channel_sessions.provider as Parameters<typeof getPublisher>[0], target.channel_sessions.platform as string | null)
      : null;

    if (externalId && publisher?.consultar && target?.channel_sessions) {
      const consulta = await publisher.consultar({
        organizationId: orgId,
        sessionRef: resolveSessionRef(target.channel_sessions as unknown as Parameters<typeof resolveSessionRef>[0]),
        externalId,
      });
      if (consulta.estado === "sent") {
        await admin
          .from("publication_executions")
          .update({ status: "sent", external_url: consulta.url ?? null, provider_status: consulta.providerStatus ?? null, finished_at: agora.toISOString(), lease_until: null, metadata: { ...metadata, reconciled_at: agora.toISOString() } })
          .eq("organization_id", orgId)
          .eq("id", id)
          .eq("status", "sending");
        resultado.reconciled += 1;
      } else if (consulta.estado === "failed") {
        await admin
          .from("publication_executions")
          .update({ status: "failed", error_code: consulta.codigo ?? "provider_failed", error_category: consulta.categoria ?? "permanente", error_message: (consulta.mensagem ?? "O provedor não concluiu a publicação.").slice(0, 500), provider_status: consulta.providerStatus ?? null, finished_at: agora.toISOString(), lease_until: null, metadata: { ...metadata, reconciled_at: agora.toISOString() } })
          .eq("organization_id", orgId)
          .eq("id", id)
          .eq("status", "sending");
        resultado.reconciled += 1;
        void avisarFalhaDePublicacao(admin, { organizationId: orgId, occurrenceId: occId, titulo, quando, destino, motivo: consulta.mensagem ?? "O provedor não concluiu a publicação." });
      } else {
        // `accepted` ou `unknown`: ainda processando, ou sem resposta. Marca a
        // consulta para o `updated_at` andar e o próximo tick perguntar de novo.
        await admin
          .from("publication_executions")
          .update({ provider_status: consulta.providerStatus ?? null, metadata: { ...metadata, last_probe_at: agora.toISOString() } })
          .eq("organization_id", orgId)
          .eq("id", id)
          .eq("status", "sending");
        logger.info("[publicacoes] execução ainda em processamento no provedor", { execution_id: id, requestId });
      }
      continue;
    }

    const enviados = typeof metadata[CHAVE_DOS_ARQUIVOS_ENVIADOS] === "number" ? (metadata[CHAVE_DOS_ARQUIVOS_ENVIADOS] as number) : 0;
    const mensagem =
      enviados > 0
        ? `A execução ficou presa e foi encerrada sem reenvio automático. ${enviados} arquivo(s) já tinham saído; confira no destino antes de reenviar.`
        : "A execução ficou presa e foi encerrada sem reenvio automático. Confira no destino antes de reenviar.";
    await admin
      .from("publication_executions")
      .update({ status: "failed", error_code: "worker_timeout", error_category: "permanente", error_message: mensagem, finished_at: agora.toISOString(), lease_until: null })
      .eq("organization_id", orgId)
      .eq("id", id)
      .eq("status", "sending");
    resultado.timed_out += 1;
    void avisarFalhaDePublicacao(admin, { organizationId: orgId, occurrenceId: occId, titulo, quando, destino, motivo: mensagem });
  }

  for (const occId of tocadas) {
    const { error: erroRollup } = await admin.rpc("fn_rollup_publication_occurrence", { p_occurrence: occId });
    if (erroRollup) logger.error("[publicacoes] rollup falhou", { occurrence_id: occId, error: erroRollup.message, requestId });
  }
  return resultado;
}
