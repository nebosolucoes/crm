/**
 * Passo 3 do tick: arrendar execuções e publicar.
 *
 * O claim (`fn_claim_publication_executions`) devolve execuções por
 * (ocorrência, destino), todas do mesmo destino ao mesmo worker; aqui elas
 * saem em ordem de `position` — é o que mantém 5 Stories na ordem em que a
 * pessoa os pôs. A linha vai a `sending` ANTES da chamada externa (se o
 * processo cair no meio, a tela mostra "enviando" e a reconciliação decide),
 * e o desfecho é gravado com guarda de status: só quem está em `sending` com
 * este `worker_id` fecha a linha.
 *
 * Quem entrega é `getPublisher(provider, plataforma)` — este arquivo não sabe
 * (e não pode saber) qual provedor há por trás; sabe rede, formato e conta.
 */
import { getPublisher, type MidiaDoPedido, type ResultadoDePublicacao } from "@/lib/channels/publicacao";
import { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef } from "@/lib/channels/session-ref";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

import {
  CHAVE_DOS_ARQUIVOS_ENVIADOS,
  type FormatoDaPublicacao,
  type RedeDaPublicacao,
} from "../schema";
import {
  LEASE_DA_EXECUCAO_S,
  MAXIMO_DE_TENTATIVAS,
  PAUSA_ENTRE_GRUPOS_MS,
  PAUSA_ENTRE_POSTS_SOCIAIS_MS,
  VALIDADE_DA_URL_ASSINADA_S,
  proximaTentativaEm,
} from "../politica";
import { avisarFalhaDePublicacao, rotuloDaRede, rotuloDoFormato } from "./avisos";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface OpcoesDeExecucao {
  limite?: number;
  /** Quando parar de pegar trabalho novo (instante absoluto, ms). */
  prazoMs?: number;
  esperar?: (ms: number) => Promise<void>;
  /** Injeção para teste: o relógio dos carimbos de tempo. */
  relogio?: () => Date;
  workerId: string;
}

export interface ResultadoDaExecucao {
  claimed: number;
  sent: number;
  accepted: number;
  failed: number;
}

interface ExecucaoArrendada {
  id: string;
  organization_id: string;
  publication_id: string;
  occurrence_id: string;
  target_id: string;
  group_id: string | null;
  media_id: string | null;
  position: number;
  attempt: number;
  idempotency_key: string;
  metadata: Record<string, unknown> | null;
}

interface Contexto {
  publication: { id: string; title: string | null; body: string | null };
  target: { id: string; network: RedeDaPublicacao; format: FormatoDaPublicacao; channel_session_id: string; settings: Record<string, unknown> };
  session: Record<string, unknown> & { id: string; provider: string; platform: string | null; status: string | null; archived_at: string | null };
  media: Array<{ id: string; kind: MidiaDoPedido["kind"]; storage_path: string; mime: string; filename: string | null; size_bytes: number; cover_storage_path: string | null; position: number }>;
  grupos: Map<string, { name: string; external_group_id: string; is_active: boolean }>;
  occurrence: { id: string; scheduled_at: string };
}

const esperarPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function carregarContexto(admin: AdminClient, e: ExecucaoArrendada): Promise<Contexto | null> {
  const [pub, target, occ, medias] = await Promise.all([
    admin.from("publications").select("id, title, body").eq("organization_id", e.organization_id).eq("id", e.publication_id).maybeSingle(),
    admin
      .from("publication_targets")
      .select(`id, network, format, channel_session_id, settings, channel_sessions!publication_targets_channel_org_fkey(id, provider, platform, status, archived_at, ${CHANNEL_SESSION_REF_COLUMNS})`)
      .eq("organization_id", e.organization_id)
      .eq("id", e.target_id)
      .maybeSingle(),
    admin.from("publication_occurrences").select("id, scheduled_at").eq("organization_id", e.organization_id).eq("id", e.occurrence_id).maybeSingle(),
    admin
      .from("publication_media")
      .select("id, kind, storage_path, mime, filename, size_bytes, cover_storage_path, position")
      .eq("organization_id", e.organization_id)
      .eq("publication_id", e.publication_id)
      .order("position", { ascending: true }),
  ]);
  if (!pub.data || !target.data || !occ.data) return null;
  const t = target.data as unknown as Record<string, unknown>;
  const session = t.channel_sessions as Contexto["session"] | null;
  if (!session) return null;
  const grupos = new Map<string, { name: string; external_group_id: string; is_active: boolean }>();
  if (t.network === "whatsapp") {
    const { data } = await admin
      .from("publication_target_groups")
      .select("group_id, scheduled_whatsapp_groups!publication_target_groups_group_org_channel_fkey(name, external_group_id, is_active)")
      .eq("organization_id", e.organization_id)
      .eq("target_id", e.target_id);
    for (const g of (data ?? []) as unknown as Array<{ group_id: string; scheduled_whatsapp_groups: { name: string; external_group_id: string; is_active: boolean } | null }>) {
      if (g.scheduled_whatsapp_groups) grupos.set(g.group_id, g.scheduled_whatsapp_groups);
    }
  }
  return {
    publication: pub.data as Contexto["publication"],
    target: {
      id: t.id as string,
      network: t.network as RedeDaPublicacao,
      format: t.format as FormatoDaPublicacao,
      channel_session_id: t.channel_session_id as string,
      settings: (t.settings as Record<string, unknown>) ?? {},
    },
    session,
    media: ((medias.data ?? []) as unknown as Array<Record<string, unknown>>).map((m) => ({
      id: m.id as string,
      kind: m.kind as MidiaDoPedido["kind"],
      storage_path: m.storage_path as string,
      mime: m.mime as string,
      filename: (m.filename as string | null) ?? null,
      size_bytes: Number(m.size_bytes),
      cover_storage_path: (m.cover_storage_path as string | null) ?? null,
      position: Number(m.position),
    })),
    grupos,
    occurrence: occ.data as Contexto["occurrence"],
  };
}

async function assinar(admin: AdminClient, path: string): Promise<string | null> {
  const { data, error } = await admin.storage.from("whatsapp-media").createSignedUrl(path, VALIDADE_DA_URL_ASSINADA_S);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

type Fechamento =
  | { status: "sent"; external_post_id: string; external_url: string | null; provider_status?: string | null; extra?: Record<string, unknown> }
  | { status: "sending"; external_post_id: string; provider_status: string | null; extra?: Record<string, unknown> }
  | { status: "failed"; error_code: string; error_category: "transitorio" | "permanente"; error_message: string; retry_at?: string | null; external_post_id?: string | null; extra?: Record<string, unknown> };

async function fechar(admin: AdminClient, e: ExecucaoArrendada, workerId: string, f: Fechamento, raw: unknown, agora: Date): Promise<boolean> {
  const metadata = { ...(e.metadata ?? {}), ...(f.extra ?? {}) };
  const provider_response = raw && typeof raw === "object" ? redigir(raw as Record<string, unknown>) : null;
  const patch: Record<string, unknown> =
    f.status === "sent"
      ? { status: "sent", external_post_id: f.external_post_id, external_url: f.external_url, provider_status: f.provider_status ?? null, finished_at: agora.toISOString(), provider_response, metadata, lease_until: null }
      : f.status === "sending"
        ? { status: "sending", external_post_id: f.external_post_id, provider_status: f.provider_status, provider_response, metadata, lease_until: null }
        : {
            status: "failed",
            error_code: f.error_code,
            error_category: f.error_category,
            error_message: f.error_message.slice(0, 500),
            retry_at: f.retry_at ?? null,
            external_post_id: f.external_post_id ?? null,
            finished_at: agora.toISOString(),
            provider_response,
            metadata,
            lease_until: null,
          };
  const { data, error } = await admin
    .from("publication_executions")
    .update(patch)
    .eq("organization_id", e.organization_id)
    .eq("id", e.id)
    .eq("status", "sending")
    .eq("worker_id", workerId)
    .select("id");
  if (error) throw new Error(`publicacoes_execution_finalize_failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** O que guardar da resposta do provedor: pequeno e sem segredo. */
function redigir(raw: Record<string, unknown>): Record<string, unknown> {
  const texto = JSON.stringify(raw, (k, v) => (/token|secret|authorization|key/i.test(k) ? "[redigido]" : v));
  return texto.length > 8000 ? { truncado: true, inicio: texto.slice(0, 8000) } : (JSON.parse(texto) as Record<string, unknown>);
}

function descreverDestino(ctx: Contexto, e: ExecucaoArrendada): string {
  const rede = rotuloDaRede(ctx.target.network);
  if (ctx.target.network === "whatsapp") {
    const g = e.group_id ? ctx.grupos.get(e.group_id) : null;
    return `${rede} · ${g?.name ?? "grupo"}`;
  }
  return `${rede} · ${rotuloDoFormato(ctx.target.format)}`;
}

export async function executarExecucoesArrendadas(
  admin: AdminClient,
  agora: Date,
  requestId: string,
  opcoes: OpcoesDeExecucao,
): Promise<ResultadoDaExecucao> {
  const resultado: ResultadoDaExecucao = { claimed: 0, sent: 0, accepted: 0, failed: 0 };
  const esperar = opcoes.esperar ?? esperarPadrao;
  const relogio = opcoes.relogio ?? (() => new Date());
  const prazo = opcoes.prazoMs ?? Number.POSITIVE_INFINITY;

  const { data, error } = await admin.rpc("fn_claim_publication_executions", {
    p_limit: opcoes.limite ?? 20,
    p_worker_id: opcoes.workerId,
    p_lease_seconds: LEASE_DA_EXECUCAO_S,
  });
  if (error) throw new Error(`publicacoes_claim_failed: ${error.message}`);
  const arrendadas = ((data ?? []) as unknown as ExecucaoArrendada[]).map((e) => ({ ...e, position: Number(e.position) }));
  resultado.claimed = arrendadas.length;
  if (arrendadas.length === 0) return resultado;

  // Agrupa por (ocorrência, destino) e ordena por posição dentro do grupo.
  const grupos = new Map<string, ExecucaoArrendada[]>();
  for (const e of arrendadas) {
    const k = `${e.occurrence_id}/${e.target_id}`;
    const lista = grupos.get(k) ?? [];
    lista.push(e);
    grupos.set(k, lista);
  }

  const ocorrenciasTocadas = new Set<string>();
  const contextos = new Map<string, Contexto | null>();
  let ultimaSessao: string | null = null;

  for (const [, lista] of grupos) {
    lista.sort((a, b) => a.position - b.position || a.attempt - b.attempt);
    for (const e of lista) {
      if (Date.now() > prazo) {
        // Devolve o lease: a linha continua `pending` e volta no próximo tick.
        await admin.from("publication_executions").update({ lease_until: null, worker_id: null }).eq("organization_id", e.organization_id).eq("id", e.id).eq("status", "pending");
        continue;
      }
      ocorrenciasTocadas.add(e.occurrence_id);
      let ctx = contextos.get(e.target_id);
      if (ctx === undefined) {
        ctx = await carregarContexto(admin, e);
        contextos.set(e.target_id, ctx);
      }

      // `sending` antes de qualquer chamada externa.
      const { data: marcada, error: erroSending } = await admin
        .from("publication_executions")
        .update({ status: "sending", started_at: relogio().toISOString(), request_id: requestId })
        .eq("organization_id", e.organization_id)
        .eq("id", e.id)
        .eq("status", "pending")
        .eq("worker_id", opcoes.workerId)
        .select("id");
      if (erroSending) throw new Error(`publicacoes_sending_failed: ${erroSending.message}`);
      if (!marcada || marcada.length === 0) continue;

      const agoraMesmo = relogio();
      const falhar = async (codigo: string, categoria: "transitorio" | "permanente", mensagem: string, extra: { retryAfterMs?: number | null; externalId?: string | null; raw?: unknown; sentFiles?: number } = {}) => {
        const retry = categoria === "transitorio" && e.attempt < MAXIMO_DE_TENTATIVAS ? proximaTentativaEm(e.attempt, agoraMesmo, extra.retryAfterMs) : null;
        await fechar(admin, e, opcoes.workerId, {
          status: "failed",
          error_code: codigo,
          error_category: categoria,
          error_message: mensagem,
          retry_at: retry ? retry.toISOString() : null,
          external_post_id: extra.externalId ?? null,
          extra: extra.sentFiles !== undefined ? { [CHAVE_DOS_ARQUIVOS_ENVIADOS]: extra.sentFiles } : undefined,
        }, extra.raw, agoraMesmo);
        resultado.failed += 1;
        if (!retry && ctx) {
          void avisarFalhaDePublicacao(admin, {
            organizationId: e.organization_id,
            occurrenceId: e.occurrence_id,
            titulo: ctx.publication.title,
            quando: ctx.occurrence.scheduled_at,
            destino: descreverDestino(ctx, e),
            motivo: mensagem,
          });
        }
      };

      if (!ctx) {
        await falhar("context_unavailable", "permanente", "A publicação, o destino ou a conexão não existem mais.");
        continue;
      }
      if (ctx.session.archived_at) {
        await falhar("channel_unavailable", "permanente", "A conexão foi removida.");
        continue;
      }
      if (ctx.session.status !== "WORKING") {
        if (ctx.session.status === "STARTING") await falhar("channel_starting", "transitorio", "A conexão ainda está iniciando; tentando de novo em instantes.");
        else await falhar("channel_not_working", "permanente", `A conexão não está ativa (${ctx.session.status ?? "sem status"}). Reconecte em Conexões.`);
        continue;
      }
      const publisher = getPublisher(ctx.session.provider as Parameters<typeof getPublisher>[0], ctx.session.platform);
      if (!publisher) {
        await falhar("publishing_not_supported", "permanente", "Esta conexão não publica conteúdo agendado.");
        continue;
      }

      // Mídia desta unidade: um arquivo (Stories) ou todos.
      const midiasDaUnidade = e.media_id ? ctx.media.filter((m) => m.id === e.media_id) : ctx.media;
      if (e.media_id && midiasDaUnidade.length === 0) {
        await falhar("media_missing", "permanente", "O arquivo deste Story foi removido da publicação.");
        continue;
      }
      const media: MidiaDoPedido[] = [];
      let assinaturaFalhou = false;
      for (const m of midiasDaUnidade) {
        const url = await assinar(admin, m.storage_path);
        const coverUrl = m.cover_storage_path ? await assinar(admin, m.cover_storage_path) : null;
        if (!url) {
          assinaturaFalhou = true;
          break;
        }
        media.push({ url, mime: m.mime, kind: m.kind, filename: m.filename, sizeBytes: m.size_bytes, coverUrl });
      }
      if (assinaturaFalhou) {
        await falhar("storage_sign_failed", "transitorio", "Não foi possível preparar a mídia para envio.");
        continue;
      }

      let to: string | null = null;
      if (ctx.target.network === "whatsapp") {
        const g = e.group_id ? ctx.grupos.get(e.group_id) : null;
        if (!g) {
          await falhar("group_missing", "permanente", "O grupo não está mais na lista desta publicação.");
          continue;
        }
        if (!g.is_active) {
          await falhar("group_inactive", "permanente", `O grupo "${g.name}" está desativado no cadastro.`);
          continue;
        }
        to = g.external_group_id;
      }

      // Espaçamento anti-abuso entre unidades da MESMA sessão.
      const sessaoAtual = ctx.session.id;
      if (ultimaSessao === sessaoAtual) {
        await esperar(ctx.target.network === "whatsapp" ? PAUSA_ENTRE_GRUPOS_MS : PAUSA_ENTRE_POSTS_SOCIAIS_MS);
      }
      ultimaSessao = sessaoAtual;

      let r: ResultadoDePublicacao;
      try {
        r = await publisher.publish({
          organizationId: e.organization_id,
          sessionRef: resolveSessionRef(ctx.session as unknown as Parameters<typeof resolveSessionRef>[0]),
          network: ctx.target.network,
          format: ctx.target.format,
          caption: ctx.publication.body,
          media,
          settings: ctx.target.settings,
          idempotencyKey: e.idempotency_key,
          referencia: e.id,
          to,
          esperar,
          onProgresso: async (enviados, ids) => {
            await admin
              .from("publication_executions")
              .update({ metadata: { ...(e.metadata ?? {}), [CHAVE_DOS_ARQUIVOS_ENVIADOS]: enviados, external_ids: ids } })
              .eq("organization_id", e.organization_id)
              .eq("id", e.id);
          },
        });
      } catch (err) {
        r = { estado: "failed", codigo: "publisher_threw", categoria: "permanente", mensagem: err instanceof Error ? err.message : String(err) };
      }

      if (r.estado === "sent") {
        await fechar(admin, e, opcoes.workerId, { status: "sent", external_post_id: r.externalId, external_url: r.url, provider_status: r.providerStatus ?? null, extra: r.externalIds ? { external_ids: r.externalIds, [CHAVE_DOS_ARQUIVOS_ENVIADOS]: r.externalIds.length } : undefined }, r.raw, relogio());
        resultado.sent += 1;
      } else if (r.estado === "accepted") {
        await fechar(admin, e, opcoes.workerId, { status: "sending", external_post_id: r.externalId, provider_status: r.providerStatus, extra: { accepted_at: relogio().toISOString() } }, r.raw, relogio());
        resultado.accepted += 1;
      } else {
        await falhar(r.codigo, r.categoria, r.mensagem, { retryAfterMs: r.retryAfterMs, externalId: r.externalId, raw: r.raw, sentFiles: r.sentFiles });
      }
    }
  }

  for (const occId of ocorrenciasTocadas) {
    const { error: erroRollup } = await admin.rpc("fn_rollup_publication_occurrence", { p_occurrence: occId });
    if (erroRollup) logger.error("[publicacoes] rollup falhou", { occurrence_id: occId, error: erroRollup.message, requestId });
  }
  return resultado;
}
