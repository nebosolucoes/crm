/**
 * Passo 2 do tick: ocorrência vencida vira execuções.
 *
 * Uma ocorrência `pending` cujo horário chegou passa a `processing` (com
 * guarda no status — dois ticks não expandem a mesma) e ganha UMA execução
 * por unidade de efeito: por destino; por GRUPO num destino de WhatsApp; por
 * ARQUIVO num destino de Stories. Os destinos são os da publicação, ou só os
 * que a ocorrência escolheu em `publication_occurrence_targets` (0284) quando
 * há linhas lá. Antes disso, três portas:
 *
 *  - janela perdida (`politica.ts`): venceu há mais que a tolerância → `skipped`
 *    com `missed_window` e aviso. É o que impede a rajada depois de uma VPS parada;
 *  - plano: `fn_org_has_feature('broadcast')` uma vez por organização por tick;
 *    sem o recurso → `skipped/feature_not_entitled` e o aviso de plano;
 *  - publicação excluída ou sem destino vivo → `skipped`.
 *
 * Também cria a TENTATIVA SEGUINTE de execuções que falharam de forma
 * transitória e cujo `retry_at` venceu (`attempt + 1`, `pending`).
 */
import { avisarBloqueioPorRecurso } from "@/lib/entitlements/aviso-na-central";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

import { MAXIMO_DE_TENTATIVAS, MOTIVO_JANELA_PERDIDA, ocorrenciaPerdeuAJanela } from "../politica";
import { unidadesDoDestino } from "../regras-por-destino";
import type { FormatoDaPublicacao } from "../schema";
import { avisarFalhaDePublicacao, rotuloDaRede, rotuloDoFormato } from "./avisos";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ResultadoDaExpansao {
  expanded: number;
  executions: number;
  skipped: number;
  retries: number;
}

interface OcorrenciaVencida {
  id: string;
  organization_id: string;
  publication_id: string;
  scheduled_at: string;
}

async function organizacaoTemPublicacoes(
  admin: AdminClient,
  memoria: Map<string, boolean | null>,
  organizationId: string,
  requestId: string,
): Promise<boolean | null> {
  if (memoria.has(organizationId)) return memoria.get(organizationId) ?? null;
  const { data, error } = await admin.rpc("fn_org_has_feature", { p_org: organizationId, p_feature: "broadcast" });
  if (error) {
    // Blip do banco não segura uma publicação de quem tem o recurso.
    logger.warn("[publicacoes] plano não pôde ser conferido — seguindo", { organization_id: organizationId, error: error.message, requestId });
    memoria.set(organizationId, null);
    return null;
  }
  const tem = data === true;
  memoria.set(organizationId, tem);
  return tem;
}

async function pular(admin: AdminClient, occ: OcorrenciaVencida, motivo: string, agora: Date): Promise<void> {
  const { error } = await admin
    .from("publication_occurrences")
    .update({ status: "skipped", skipped_reason: motivo, processed_at: agora.toISOString(), finished_at: agora.toISOString() })
    .eq("organization_id", occ.organization_id)
    .eq("id", occ.id);
  if (error) throw new Error(`publicacoes_skip_failed: ${error.message}`);
  await admin.rpc("fn_rollup_publication_occurrence", { p_occurrence: occ.id });
}

export async function expandirOcorrenciasVencidas(
  admin: AdminClient,
  agora: Date,
  requestId: string,
  limite = 100,
): Promise<ResultadoDaExpansao> {
  const resultado: ResultadoDaExpansao = { expanded: 0, executions: 0, skipped: 0, retries: 0 };
  const planoPorOrg = new Map<string, boolean | null>();

  const { data, error } = await admin
    .from("publication_occurrences")
    .select("id, organization_id, publication_id, scheduled_at")
    .eq("status", "pending")
    .lte("scheduled_at", agora.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(Math.max(1, Math.min(limite, 500)));
  if (error) throw new Error(`publicacoes_due_query_failed: ${error.message}`);

  for (const occ of (data ?? []) as OcorrenciaVencida[]) {
    // Só quem vira `processing` expande — o outro tick vê zero linhas e segue.
    const { data: tomada, error: erroClaim } = await admin
      .from("publication_occurrences")
      .update({ status: "processing", processed_at: agora.toISOString() })
      .eq("organization_id", occ.organization_id)
      .eq("id", occ.id)
      .eq("status", "pending")
      .select("id");
    if (erroClaim) throw new Error(`publicacoes_occurrence_claim_failed: ${erroClaim.message}`);
    if (!tomada || tomada.length === 0) continue;

    const { data: pub, error: erroPub } = await admin
      .from("publications")
      .select("id, title, body, deleted_at, status")
      .eq("organization_id", occ.organization_id)
      .eq("id", occ.publication_id)
      .maybeSingle();
    if (erroPub) throw new Error(`publicacoes_read_failed: ${erroPub.message}`);
    const quando = new Date(occ.scheduled_at).toISOString();
    const titulo = (pub as { title?: string | null } | null)?.title ?? null;

    if (!pub || (pub as { deleted_at?: string | null }).deleted_at || (pub as { status?: string }).status === "cancelled") {
      await pular(admin, occ, "publication_unavailable", agora);
      resultado.skipped += 1;
      continue;
    }

    if (ocorrenciaPerdeuAJanela(occ.scheduled_at, agora)) {
      await pular(admin, occ, MOTIVO_JANELA_PERDIDA, agora);
      resultado.skipped += 1;
      void avisarFalhaDePublicacao(admin, {
        organizationId: occ.organization_id,
        occurrenceId: occ.id,
        titulo,
        quando,
        destino: "nenhum destino",
        motivo: "O horário passou enquanto o sistema não estava rodando e a publicação não saiu, para não sair atrasada sem ninguém saber.",
      });
      continue;
    }

    if ((await organizacaoTemPublicacoes(admin, planoPorOrg, occ.organization_id, requestId)) === false) {
      await pular(admin, occ, "feature_not_entitled", agora);
      resultado.skipped += 1;
      void avisarBloqueioPorRecurso(admin, occ.organization_id, "broadcast", "Uma publicação agendada");
      continue;
    }

    const { data: targets, error: erroTargets } = await admin
      .from("publication_targets")
      .select("id, network, format, channel_session_id, metadata")
      .eq("organization_id", occ.organization_id)
      .eq("publication_id", occ.publication_id);
    if (erroTargets) throw new Error(`publicacoes_targets_failed: ${erroTargets.message}`);
    // 0284: a ocorrência pode ter escolhido um subconjunto dos destinos. Sem linha = todos.
    const { data: escolhidos, error: erroEscolha } = await admin
      .from("publication_occurrence_targets")
      .select("target_id")
      .eq("organization_id", occ.organization_id)
      .eq("occurrence_id", occ.id);
    if (erroEscolha) throw new Error(`publicacoes_occurrence_targets_failed: ${erroEscolha.message}`);
    const somenteEstes = new Set(((escolhidos ?? []) as Array<{ target_id: string }>).map((e) => e.target_id));
    const vivos = ((targets ?? []) as Array<{ id: string; network: string; format: string; channel_session_id: string; metadata: Record<string, unknown> | null }>)
      .filter((t) => typeof t.metadata?.removed_at !== "string")
      .filter((t) => somenteEstes.size === 0 || somenteEstes.has(t.id));
    if (vivos.length === 0) {
      await pular(admin, occ, "no_targets", agora);
      resultado.skipped += 1;
      void avisarFalhaDePublicacao(admin, {
        organizationId: occ.organization_id,
        occurrenceId: occ.id,
        titulo,
        quando,
        destino: "nenhum destino",
        motivo: "A publicação chegou ao horário sem nenhum destino escolhido.",
      });
      continue;
    }

    const [{ data: medias }, { data: grupos }] = await Promise.all([
      admin
        .from("publication_media")
        .select("id, position")
        .eq("organization_id", occ.organization_id)
        .eq("publication_id", occ.publication_id)
        .order("position", { ascending: true }),
      admin
        .from("publication_target_groups")
        .select("target_id, group_id")
        .eq("organization_id", occ.organization_id)
        .in("target_id", vivos.map((t) => t.id)),
    ]);

    const linhas: Array<Record<string, unknown>> = [];
    for (const t of vivos) {
      const base = { organization_id: occ.organization_id, publication_id: occ.publication_id, occurrence_id: occ.id, target_id: t.id, attempt: 1, status: "pending", request_id: requestId };
      if (t.network === "whatsapp") {
        const doDestino = ((grupos ?? []) as Array<{ target_id: string; group_id: string }>).filter((g) => g.target_id === t.id);
        for (const [i, g] of doDestino.entries()) linhas.push({ ...base, group_id: g.group_id, position: i + 1 });
      } else if (unidadesDoDestino(t.format as FormatoDaPublicacao) === "por_midia") {
        for (const m of (medias ?? []) as Array<{ id: string; position: number }>) linhas.push({ ...base, media_id: m.id, position: Number(m.position) });
      } else {
        linhas.push({ ...base, position: 0 });
      }
    }
    if (linhas.length === 0) {
      await pular(admin, occ, "no_units", agora);
      resultado.skipped += 1;
      void avisarFalhaDePublicacao(admin, {
        organizationId: occ.organization_id,
        occurrenceId: occ.id,
        titulo,
        quando,
        destino: `${rotuloDaRede(vivos[0]!.network)} · ${rotuloDoFormato(vivos[0]!.format)}`,
        motivo: "Não havia grupos (ou arquivos, no caso de Stories) para publicar.",
      });
      continue;
    }
    const { error: erroInsert } = await admin.from("publication_executions").insert(linhas);
    if (erroInsert && erroInsert.code !== "23505") throw new Error(`publicacoes_executions_insert_failed: ${erroInsert.message}`);
    resultado.expanded += 1;
    resultado.executions += linhas.length;
  }

  // Tentativas seguintes de quem falhou de forma transitória.
  const { data: vencidas, error: erroRetry } = await admin
    .from("publication_executions")
    .select("id, organization_id, publication_id, occurrence_id, target_id, group_id, media_id, position, attempt")
    .eq("status", "failed")
    .eq("error_category", "transitorio")
    .not("retry_at", "is", null)
    .lte("retry_at", agora.toISOString())
    .lt("attempt", MAXIMO_DE_TENTATIVAS)
    .limit(200);
  if (erroRetry) throw new Error(`publicacoes_retry_query_failed: ${erroRetry.message}`);
  for (const e of (vencidas ?? []) as Array<Record<string, unknown>>) {
    const { error: erroIns } = await admin.from("publication_executions").insert({
      organization_id: e.organization_id,
      publication_id: e.publication_id,
      occurrence_id: e.occurrence_id,
      target_id: e.target_id,
      group_id: e.group_id,
      media_id: e.media_id,
      position: e.position,
      attempt: (e.attempt as number) + 1,
      status: "pending",
      request_id: requestId,
      metadata: { retry_of: e.id },
    });
    // Zera o `retry_at` da falha para não recriar a mesma tentativa no tick seguinte.
    await admin.from("publication_executions").update({ retry_at: null }).eq("organization_id", e.organization_id as string).eq("id", e.id as string);
    if (erroIns && erroIns.code !== "23505") throw new Error(`publicacoes_retry_insert_failed: ${erroIns.message}`);
    if (!erroIns) resultado.retries += 1;
  }

  return resultado;
}
