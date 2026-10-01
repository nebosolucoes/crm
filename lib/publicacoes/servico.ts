/**
 * O serviço de domínio de Publicações — o único lugar que escreve nas seis
 * tabelas da 0283 a partir de uma intenção humana (criar, editar, reagendar,
 * cancelar, excluir, reenviar). O worker (`lib/publicacoes/worker/`) escreve
 * o RESULTADO; a tela nunca escreve.
 *
 * ─── Regras que moram aqui e em mais lugar nenhum ───────────────────────────
 *
 *  - A conta de cada destino é lida do banco, filtrada pela organização, e a
 *    rede do destino tem de ser a rede da conta. Um id de conta de outra
 *    organização simplesmente não volta daqui. Grupos idem: só os que pertencem
 *    à organização E à conexão do destino (a FK tripla do banco é o segundo
 *    cadeado; este é o primeiro, com mensagem legível).
 *  - Mídia só do prefixo desta organização (`isPublicationMediaPathOwnedBy`).
 *  - Regras por formato (`regras-por-destino.ts`) são executadas de novo aqui;
 *    a tela só as antecipa.
 *  - Editar regera as ocorrências PENDENTES; as que já saíram são história.
 *  - Recorrência materializa até o horizonte (`politica.ts`) — aqui na criação
 *    e na edição, e no worker a cada tick.
 *
 * Cliente: `createAdminClient()` (service role). Toda query filtra
 * `organization_id` explicitamente — CLAUDE.md, anti-pattern 10.
 */
import { capabilitiesOf } from "@/lib/channels/capabilities";
import { ehPlataformaSocial } from "@/lib/channels/plataformas";
import type { ChannelProvider } from "@/lib/channels/types";
import { isPublicationMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import type { createAdminClient } from "@/lib/supabase/admin";
import { FUSO_PADRAO, fusoValido } from "@/lib/tempo/fusos";

import { HORIZONTE_DE_RECORRENCIA_DIAS, TETO_DE_OCORRENCIAS_PENDENTES } from "./politica";
import { proximasOcorrencias } from "./recorrencia";
import { estadosDosDestinos, type EstadoDoDestino, type ExecucaoParaEstado } from "./estado-do-destino";
import { validarDestino, type ProblemaDoDestino } from "./regras-por-destino";
import {
  chaveDeDestino,
  type AlterarPublicacao,
  type CriarPublicacao,
  type DestinoDaPublicacao,
  type FormatoDaPublicacao,
  type MidiaDaPublicacao,
  type OcorrenciaDaPublicacao,
  type RedeDaPublicacao,
  type StatusDaExecucao,
  type StatusDaOcorrencia,
  type StatusDaPublicacao,
  type TipoDeRecorrencia,
} from "./schema";

type AdminClient = ReturnType<typeof createAdminClient>;

// ─── Erros do domínio (a rota traduz em HTTP) ───────────────────────────────

export class ErroDePublicacao extends Error {
  constructor(
    public readonly codigo:
      | "validation_failed"
      | "publication_invalid_for_format"
      | "publication_no_targets"
      | "publication_account_unavailable"
      | "publication_occurrence_closed"
      | "not_found"
      | "invalid_state",
    mensagem: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(mensagem);
  }
}

// ─── Contas publicáveis ─────────────────────────────────────────────────────

export interface ContaPublicavel {
  id: string;
  network: RedeDaPublicacao;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  status: string;
  /** A conta está apta a publicar AGORA (conectada e com a capacidade). */
  disponivel: boolean;
  /** Só WhatsApp: a conexão lista e envia para grupos. */
  publica_grupos: boolean;
}

/** Rede de uma conexão, pela plataforma da sessão. Página do Facebook chega como `messenger`. */
export function redeDaPlataforma(platform: string | null | undefined): RedeDaPublicacao | null {
  if (platform === "whatsapp" || !platform) return "whatsapp";
  if (platform === "instagram") return "instagram";
  if (platform === "messenger") return "facebook";
  return null;
}

interface SessaoRow {
  id: string;
  provider: string;
  platform: string | null;
  status: string | null;
  display_name: string | null;
  phone_number: string | null;
  archived_at: string | null;
  metadata: Record<string, unknown> | null;
}

function capacidadesSeguras(provider: string, platform: string | null) {
  try {
    return capabilitiesOf(provider as ChannelProvider, platform);
  } catch {
    return null;
  }
}

export async function contasPublicaveis(admin: AdminClient, orgId: string): Promise<ContaPublicavel[]> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, provider, platform, status, display_name, phone_number, archived_at, metadata")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`publicacoes_contas_failed: ${error.message}`);
  const saida: ContaPublicavel[] = [];
  for (const row of (data ?? []) as unknown as SessaoRow[]) {
    const network = redeDaPlataforma(row.platform);
    if (!network) continue;
    const caps = capacidadesSeguras(row.provider, row.platform);
    if (!caps) continue;
    const social = ehPlataformaSocial(row.platform);
    const publicaGrupos = !social && caps.groups !== "none";
    if (!social && !publicaGrupos) continue;
    const meta = row.metadata ?? {};
    saida.push({
      id: row.id,
      network,
      display_name: row.display_name ?? row.phone_number ?? null,
      username: typeof meta.social_username === "string" ? meta.social_username : null,
      avatar_url: typeof meta.social_avatar_url === "string" ? meta.social_avatar_url : null,
      status: row.status ?? "STARTING",
      disponivel: row.status === "WORKING",
      publica_grupos: publicaGrupos,
    });
  }
  return saida;
}

// ─── Fuso ───────────────────────────────────────────────────────────────────

export async function fusoDaOrganizacao(admin: AdminClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  const tz = (data as { timezone?: string } | null)?.timezone;
  return tz && fusoValido(tz) ? tz : FUSO_PADRAO;
}

// ─── Leitura: a publicação montada ──────────────────────────────────────────

export interface MidiaLida {
  id: string;
  position: number;
  kind: string;
  storage_path: string;
  mime: string;
  size_bytes: number;
  filename: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  cover_storage_path: string | null;
}

export interface DestinoLido {
  id: string;
  network: RedeDaPublicacao;
  format: FormatoDaPublicacao;
  channel_session_id: string;
  settings: Record<string, unknown>;
  removido: boolean;
  group_ids: string[];
  /** Preenchido pela leitura completa: nome da conta e dos grupos. */
  display_name?: string | null;
  groups?: Array<{ id: string; name: string; external_group_id: string; is_active: boolean }>;
}

export interface OcorrenciaLida {
  id: string;
  scheduled_at: string;
  source: string;
  status: StatusDaOcorrencia;
  skipped_reason: string | null;
  processed_at: string | null;
  finished_at: string | null;
  /**
   * Os destinos que saem NESTA data (migration 0284): ids de `publication_targets`.
   * `null` = todos os destinos da publicação; ausente = não foi carregado.
   */
  target_ids?: string[] | null;
}

export interface PublicacaoLida {
  id: string;
  organization_id: string;
  title: string | null;
  body: string | null;
  status: StatusDaPublicacao;
  timezone: string;
  recurrence: {
    kind: TipoDeRecorrencia;
    config: Record<string, unknown>;
    repeat_until: string | null;
    max_occurrences: number | null;
  };
  created_by: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  deleted_at: string | null;
  media: MidiaLida[];
  targets: DestinoLido[];
  occurrences: OcorrenciaLida[];
}

const COLUNAS_DA_PUBLICACAO =
  "id, organization_id, title, body, status, timezone, recurrence_kind, recurrence_config, repeat_until, max_occurrences, created_by, created_at, updated_at, cancelled_at, cancel_reason, deleted_at, metadata";

export async function carregarPublicacao(
  admin: AdminClient,
  orgId: string,
  id: string,
  opcoes: { incluirExcluida?: boolean } = {},
): Promise<PublicacaoLida | null> {
  const { data: p, error } = await admin
    .from("publications")
    .select(COLUNAS_DA_PUBLICACAO)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`publicacoes_read_failed: ${error.message}`);
  if (!p) return null;
  const pub = p as unknown as Record<string, unknown>;
  if (pub.deleted_at && !opcoes.incluirExcluida) return null;

  const [media, targets, grupos, occ] = await Promise.all([
    admin
      .from("publication_media")
      .select("id, position, kind, storage_path, mime, size_bytes, filename, width, height, duration_ms, cover_storage_path")
      .eq("organization_id", orgId)
      .eq("publication_id", id)
      .order("position", { ascending: true }),
    admin
      .from("publication_targets")
      .select("id, network, format, channel_session_id, settings, metadata, channel_sessions!publication_targets_channel_org_fkey(display_name, phone_number)")
      .eq("organization_id", orgId)
      .eq("publication_id", id)
      .order("created_at", { ascending: true }),
    admin
      .from("publication_target_groups")
      .select("target_id, group_id, scheduled_whatsapp_groups!publication_target_groups_group_org_channel_fkey(name, external_group_id, is_active)")
      .eq("organization_id", orgId),
    admin
      .from("publication_occurrences")
      .select("id, scheduled_at, source, status, skipped_reason, processed_at, finished_at")
      .eq("organization_id", orgId)
      .eq("publication_id", id)
      .order("scheduled_at", { ascending: true }),
  ]);
  for (const r of [media, targets, grupos, occ]) {
    if (r.error) throw new Error(`publicacoes_read_failed: ${r.error.message}`);
  }
  const destinosPorOcorrencia = await destinosDasOcorrencias(
    admin,
    orgId,
    ((occ.data ?? []) as Array<{ id: string }>).map((o) => o.id),
  );

  const gruposPorTarget = new Map<string, DestinoLido["groups"]>();
  for (const g of (grupos.data ?? []) as unknown as Array<{
    target_id: string;
    group_id: string;
    scheduled_whatsapp_groups: { name: string; external_group_id: string; is_active: boolean } | null;
  }>) {
    const lista = gruposPorTarget.get(g.target_id) ?? [];
    lista.push({
      id: g.group_id,
      name: g.scheduled_whatsapp_groups?.name ?? "",
      external_group_id: g.scheduled_whatsapp_groups?.external_group_id ?? "",
      is_active: g.scheduled_whatsapp_groups?.is_active ?? true,
    });
    gruposPorTarget.set(g.target_id, lista);
  }

  return {
    id: pub.id as string,
    organization_id: pub.organization_id as string,
    title: (pub.title as string | null) ?? null,
    body: (pub.body as string | null) ?? null,
    status: pub.status as StatusDaPublicacao,
    timezone: pub.timezone as string,
    recurrence: {
      kind: pub.recurrence_kind as TipoDeRecorrencia,
      config: (pub.recurrence_config as Record<string, unknown>) ?? {},
      repeat_until: (pub.repeat_until as string | null) ?? null,
      max_occurrences: (pub.max_occurrences as number | null) ?? null,
    },
    created_by: (pub.created_by as string | null) ?? null,
    created_at: pub.created_at as string,
    updated_at: pub.updated_at as string,
    cancelled_at: (pub.cancelled_at as string | null) ?? null,
    cancel_reason: (pub.cancel_reason as string | null) ?? null,
    deleted_at: (pub.deleted_at as string | null) ?? null,
    media: ((media.data ?? []) as unknown as Array<Record<string, unknown>>).map((m) => ({
      id: m.id as string,
      position: Number(m.position),
      kind: m.kind as string,
      storage_path: m.storage_path as string,
      mime: m.mime as string,
      size_bytes: Number(m.size_bytes),
      filename: (m.filename as string | null) ?? null,
      width: (m.width as number | null) ?? null,
      height: (m.height as number | null) ?? null,
      duration_ms: (m.duration_ms as number | null) ?? null,
      cover_storage_path: (m.cover_storage_path as string | null) ?? null,
    })),
    targets: ((targets.data ?? []) as unknown as Array<Record<string, unknown>>).map((t) => {
      const sessao = t.channel_sessions as { display_name: string | null; phone_number: string | null } | null;
      const meta = (t.metadata as Record<string, unknown>) ?? {};
      const groups = gruposPorTarget.get(t.id as string) ?? [];
      return {
        id: t.id as string,
        network: t.network as RedeDaPublicacao,
        format: t.format as FormatoDaPublicacao,
        channel_session_id: t.channel_session_id as string,
        settings: (t.settings as Record<string, unknown>) ?? {},
        removido: typeof meta.removed_at === "string",
        group_ids: groups.map((g) => g.id),
        display_name: sessao?.display_name ?? sessao?.phone_number ?? null,
        groups,
      };
    }),
    occurrences: ((occ.data ?? []) as unknown as Array<Record<string, unknown>>).map((o) => ({
      id: o.id as string,
      scheduled_at: o.scheduled_at as string,
      source: o.source as string,
      status: o.status as StatusDaOcorrencia,
      skipped_reason: (o.skipped_reason as string | null) ?? null,
      processed_at: (o.processed_at as string | null) ?? null,
      finished_at: (o.finished_at as string | null) ?? null,
      target_ids: destinosPorOcorrencia.get(o.id as string) ?? null,
    })),
  };
}

/** `publication_occurrence_targets` das ocorrências pedidas: id → ids de destino. Sem linha = todos (fica fora do mapa). */
async function destinosDasOcorrencias(admin: AdminClient, orgId: string, occurrenceIds: string[]): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (occurrenceIds.length === 0) return mapa;
  const { data, error } = await admin
    .from("publication_occurrence_targets")
    .select("occurrence_id, target_id")
    .eq("organization_id", orgId)
    .in("occurrence_id", occurrenceIds);
  if (error) throw new Error(`publicacoes_read_failed: ${error.message}`);
  for (const r of (data ?? []) as Array<{ occurrence_id: string; target_id: string }>) {
    const lista = mapa.get(r.occurrence_id) ?? [];
    lista.push(r.target_id);
    mapa.set(r.occurrence_id, lista);
  }
  return mapa;
}

/**
 * As datas com os destinos de cada uma, na forma que o serviço grava.
 * `occurrences` manda; sem ela, `scheduled_at` = todos os destinos em cada data.
 * A mesma data repetida funde as listas (e `null` engole tudo).
 */
export function horariosDaEntrada(entrada: { scheduled_at?: string[]; occurrences?: OcorrenciaDaPublicacao[] }): Map<string, string[] | null> {
  const mapa = new Map<string, string[] | null>();
  const linhas: OcorrenciaDaPublicacao[] = entrada.occurrences ?? (entrada.scheduled_at ?? []).map((d) => ({ scheduled_at: d, targets: null }));
  for (const o of linhas) {
    const iso = new Date(o.scheduled_at).toISOString();
    const atual = mapa.get(iso);
    if (!mapa.has(iso)) mapa.set(iso, o.targets ? [...new Set(o.targets)] : null);
    else if (atual !== null && o.targets !== null) mapa.set(iso, [...new Set([...(atual ?? []), ...o.targets])]);
    else mapa.set(iso, null);
  }
  return mapa;
}

/**
 * Grava em `publication_occurrence_targets` o subconjunto de cada ocorrência
 * (apaga o que havia e insere o pedido). Chave que não bate com destino vivo é
 * erro — a data não pode apontar para uma rede que a publicação não tem.
 */
async function gravarDestinosDasOcorrencias(
  admin: AdminClient,
  orgId: string,
  ocorrencias: Array<{ id: string; scheduled_at: string }>,
  horarios: Map<string, string[] | null>,
  idPorChave: Map<string, string>,
): Promise<void> {
  if (ocorrencias.length === 0) return;
  const { error: erroLimpa } = await admin
    .from("publication_occurrence_targets")
    .delete()
    .eq("organization_id", orgId)
    .in("occurrence_id", ocorrencias.map((o) => o.id));
  if (erroLimpa) throw new Error(`publicacoes_occurrence_targets_failed: ${erroLimpa.message}`);
  const linhas: Array<{ organization_id: string; occurrence_id: string; target_id: string }> = [];
  for (const o of ocorrencias) {
    const chaves = horarios.get(new Date(o.scheduled_at).toISOString());
    if (!chaves) continue;
    // Tudo marcado = sem linha (o mesmo que "todos"), para a leitura não distinguir.
    if (chaves.length >= idPorChave.size && [...idPorChave.keys()].every((k) => chaves.includes(k))) continue;
    for (const k of chaves) {
      const targetId = idPorChave.get(k);
      if (!targetId) throw new ErroDePublicacao("validation_failed", "Uma das datas aponta para um destino que a publicação não tem.", 422, { target: k });
      linhas.push({ organization_id: orgId, occurrence_id: o.id, target_id: targetId });
    }
  }
  if (linhas.length === 0) return;
  const { error } = await admin.from("publication_occurrence_targets").insert(linhas);
  if (error) throw new Error(`publicacoes_occurrence_targets_insert_failed: ${error.message}`);
}

// ─── Validação da intenção ──────────────────────────────────────────────────

interface DestinoConferido extends DestinoDaPublicacao {
  group_ids: string[];
}

async function conferirDestinos(
  admin: AdminClient,
  orgId: string,
  destinos: DestinoDaPublicacao[],
): Promise<DestinoConferido[]> {
  if (destinos.length === 0) return [];
  const contas = await contasPublicaveis(admin, orgId);
  const porId = new Map(contas.map((c) => [c.id, c]));
  const saida: DestinoConferido[] = [];
  for (const [i, d] of destinos.entries()) {
    const conta = porId.get(d.channel_session_id);
    if (!conta) {
      throw new ErroDePublicacao("publication_account_unavailable", "A conta escolhida não existe nesta organização.", 422, {
        target: i,
      });
    }
    if (conta.network !== d.network) {
      throw new ErroDePublicacao("publication_account_unavailable", "A conta escolhida é de outra rede.", 422, { target: i });
    }
    if (d.network === "whatsapp" && !conta.publica_grupos) {
      throw new ErroDePublicacao("publication_account_unavailable", "Esta conexão não envia para grupos.", 422, { target: i });
    }
    const groupIds = [...new Set(d.group_ids ?? [])];
    if (d.network === "whatsapp") {
      const { data, error } = await admin
        .from("scheduled_whatsapp_groups")
        .select("id")
        .eq("organization_id", orgId)
        .eq("channel_session_id", d.channel_session_id)
        .in("id", groupIds);
      if (error) throw new Error(`publicacoes_groups_failed: ${error.message}`);
      const achados = new Set((data ?? []).map((g) => g.id as string));
      if (groupIds.some((g) => !achados.has(g))) {
        throw new ErroDePublicacao("validation_failed", "Grupo não encontrado nesta conexão.", 422, { target: i });
      }
    }
    saida.push({ ...d, group_ids: groupIds });
  }
  return saida;
}

function conferirMidia(orgId: string, media: MidiaDaPublicacao[]): void {
  for (const [i, m] of media.entries()) {
    if (!isPublicationMediaPathOwnedBy(m.storage_path, orgId)) {
      throw new ErroDePublicacao("validation_failed", "A mídia não pertence a esta organização.", 422, { media: i });
    }
    if (m.cover_storage_path && !isPublicationMediaPathOwnedBy(m.cover_storage_path, orgId)) {
      throw new ErroDePublicacao("validation_failed", "A capa não pertence a esta organização.", 422, { media: i });
    }
  }
}

/** Regras por formato, para TODOS os destinos de uma vez — a tela mostra tudo junto. */
export function conferirRegras(
  body: string | null | undefined,
  media: MidiaDaPublicacao[],
  destinos: DestinoConferido[],
): void {
  const problemas: Array<ProblemaDoDestino & { target: number; network: string; format: string }> = [];
  for (const [i, d] of destinos.entries()) {
    const veredito = validarDestino({
      network: d.network,
      format: d.format,
      body,
      media,
      groupCount: d.group_ids.length,
    });
    for (const e of veredito.erros) problemas.push({ ...e, target: i, network: d.network, format: d.format });
  }
  if (problemas.length > 0) {
    throw new ErroDePublicacao(
      "publication_invalid_for_format",
      problemas[0]!.mensagem,
      422,
      { problemas },
    );
  }
}

function instantesValidos(datas: string[], agora: Date): string[] {
  const unicos = [...new Set(datas.map((d) => new Date(d).toISOString()))].sort();
  for (const d of unicos) {
    if (new Date(d).getTime() < agora.getTime() - 60_000) {
      throw new ErroDePublicacao("validation_failed", "Escolha uma data e hora no futuro.", 422, { scheduled_at: d });
    }
  }
  return unicos;
}

// ─── Materialização da recorrência ──────────────────────────────────────────

export async function materializarRecorrencia(
  admin: AdminClient,
  publicacao: {
    id: string;
    organization_id: string;
    timezone: string;
    recurrence_kind: TipoDeRecorrencia;
    recurrence_config: Record<string, unknown>;
    repeat_until: string | null;
    max_occurrences: number | null;
  },
  agora: Date,
): Promise<number> {
  if (publicacao.recurrence_kind === "none") return 0;
  const { data: existentes, error } = await admin
    .from("publication_occurrences")
    .select("scheduled_at, status, source")
    .eq("organization_id", publicacao.organization_id)
    .eq("publication_id", publicacao.id)
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(`publicacoes_occurrences_failed: ${error.message}`);
  const linhas = (existentes ?? []) as Array<{ scheduled_at: string; status: string; source: string }>;
  if (linhas.length === 0) return 0;

  const pendentes = linhas.filter((l) => l.status === "pending").length;
  if (pendentes >= TETO_DE_OCORRENCIAS_PENDENTES) return 0;

  const base = new Date(linhas[0]!.scheduled_at);
  const ultima = new Date(linhas[linhas.length - 1]!.scheduled_at);
  const ate = new Date(agora.getTime() + HORIZONTE_DE_RECORRENCIA_DIAS * 24 * 60 * 60 * 1000);
  const novas = proximasOcorrencias({
    kind: publicacao.recurrence_kind,
    config: publicacao.recurrence_config as Record<string, never>,
    base,
    fuso: publicacao.timezone,
    apos: ultima,
    ate,
    repeatUntil: publicacao.repeat_until ? new Date(publicacao.repeat_until) : null,
    maxOccurrences: publicacao.max_occurrences,
    jaExistentes: linhas.length,
    limite: TETO_DE_OCORRENCIAS_PENDENTES - pendentes,
  });
  if (novas.length === 0) return 0;
  const { error: erroInsert } = await admin.from("publication_occurrences").upsert(
    novas.map((d) => ({
      organization_id: publicacao.organization_id,
      publication_id: publicacao.id,
      scheduled_at: d.toISOString(),
      source: "recurrence",
      status: "pending",
    })),
    { onConflict: "publication_id,scheduled_at", ignoreDuplicates: true },
  );
  if (erroInsert) throw new Error(`publicacoes_materialize_failed: ${erroInsert.message}`);
  return novas.length;
}

// ─── Criar ──────────────────────────────────────────────────────────────────

export interface ContextoDeEscrita {
  orgId: string;
  userId: string;
  agora?: Date;
}

export async function criarPublicacao(
  admin: AdminClient,
  ctx: ContextoDeEscrita,
  entrada: CriarPublicacao,
): Promise<PublicacaoLida> {
  const agora = ctx.agora ?? new Date();
  conferirMidia(ctx.orgId, entrada.media);
  const destinos = await conferirDestinos(admin, ctx.orgId, entrada.targets);
  if (entrada.status === "scheduled") conferirRegras(entrada.body, entrada.media, destinos);
  const horarios = horariosDaEntrada(entrada);
  const datas = entrada.status === "scheduled" ? instantesValidos([...horarios.keys()], agora) : [...horarios.keys()].sort();
  const timezone = entrada.timezone && fusoValido(entrada.timezone) ? entrada.timezone : await fusoDaOrganizacao(admin, ctx.orgId);

  const { data: criada, error } = await admin
    .from("publications")
    .insert({
      organization_id: ctx.orgId,
      title: entrada.title ?? null,
      body: entrada.body ?? null,
      status: entrada.status,
      timezone,
      recurrence_kind: entrada.recurrence.kind,
      recurrence_config: entrada.recurrence.config,
      repeat_until: entrada.recurrence.repeat_until ?? null,
      max_occurrences: entrada.recurrence.max_occurrences ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
      metadata: entrada.metadata ?? {},
    })
    .select("id")
    .single();
  if (error || !criada) throw new Error(`publicacoes_insert_failed: ${error?.message}`);
  const id = criada.id as string;

  await gravarMidias(admin, ctx.orgId, id, entrada.media);
  const idPorChave = await gravarDestinos(admin, ctx.orgId, id, destinos, []);
  if (datas.length > 0) {
    const { data: criadas, error: erroOcc } = await admin
      .from("publication_occurrences")
      .insert(datas.map((d) => ({ organization_id: ctx.orgId, publication_id: id, scheduled_at: d, source: "manual", status: "pending" })))
      .select("id, scheduled_at");
    if (erroOcc) throw new Error(`publicacoes_occurrences_insert_failed: ${erroOcc.message}`);
    await gravarDestinosDasOcorrencias(admin, ctx.orgId, (criadas ?? []) as Array<{ id: string; scheduled_at: string }>, horarios, idPorChave);
  }
  await materializarRecorrencia(
    admin,
    {
      id,
      organization_id: ctx.orgId,
      timezone,
      recurrence_kind: entrada.recurrence.kind,
      recurrence_config: entrada.recurrence.config,
      repeat_until: entrada.recurrence.repeat_until ?? null,
      max_occurrences: entrada.recurrence.max_occurrences ?? null,
    },
    agora,
  );

  const lida = await carregarPublicacao(admin, ctx.orgId, id);
  if (!lida) throw new Error("publicacoes_reload_failed");
  return lida;
}

async function gravarMidias(admin: AdminClient, orgId: string, publicationId: string, media: MidiaDaPublicacao[]): Promise<void> {
  const { data: atuais, error: erroLeitura } = await admin
    .from("publication_media")
    .select("id")
    .eq("organization_id", orgId)
    .eq("publication_id", publicationId);
  if (erroLeitura) throw new Error(`publicacoes_media_failed: ${erroLeitura.message}`);
  const mantidas = new Set(media.map((m) => m.id).filter((x): x is string => typeof x === "string"));
  const remover = (atuais ?? []).map((m) => m.id as string).filter((mid) => !mantidas.has(mid));
  if (remover.length > 0) {
    const { error } = await admin.from("publication_media").delete().eq("organization_id", orgId).in("id", remover);
    if (error) throw new Error(`publicacoes_media_delete_failed: ${error.message}`);
  }
  // Duas passadas: posições temporárias negativas evitam colisão do unique
  // (publication_id, position) quando a ordem muda entre linhas já existentes.
  for (const [i, m] of media.entries()) {
    if (m.id && mantidas.has(m.id)) {
      const { error } = await admin
        .from("publication_media")
        .update({ position: -(i + 1) })
        .eq("organization_id", orgId)
        .eq("id", m.id);
      if (error) throw new Error(`publicacoes_media_update_failed: ${error.message}`);
    }
  }
  for (const [i, m] of media.entries()) {
    if (m.id && mantidas.has(m.id)) {
      const { error } = await admin
        .from("publication_media")
        .update({ position: i + 1, cover_storage_path: m.cover_storage_path ?? null })
        .eq("organization_id", orgId)
        .eq("id", m.id);
      if (error) throw new Error(`publicacoes_media_update_failed: ${error.message}`);
    } else {
      const { error } = await admin.from("publication_media").insert({
        organization_id: orgId,
        publication_id: publicationId,
        position: i + 1,
        kind: m.kind,
        storage_path: m.storage_path,
        mime: m.mime,
        size_bytes: m.size_bytes,
        filename: m.filename ?? null,
        width: m.width ?? null,
        height: m.height ?? null,
        duration_ms: m.duration_ms ?? null,
        cover_storage_path: m.cover_storage_path ?? null,
      });
      if (error) throw new Error(`publicacoes_media_insert_failed: ${error.message}`);
    }
  }
}

/**
 * Destinos: os novos entram; os que saíram somem se ninguém executou neles,
 * ou ficam marcados `metadata.removed_at` (histórico) e fora da expansão.
 * Devolve o id de cada destino vivo por chave `rede/formato/conta` — é o que
 * liga as datas aos seus destinos.
 */
async function gravarDestinos(
  admin: AdminClient,
  orgId: string,
  publicationId: string,
  destinos: DestinoConferido[],
  atuais: DestinoLido[],
): Promise<Map<string, string>> {
  const chave = chaveDeDestino;
  const desejados = new Map(destinos.map((d) => [chave(d), d]));
  const existentes = new Map(atuais.map((t) => [chave(t), t]));
  const idPorChave = new Map<string, string>();

  for (const [k, t] of existentes) {
    if (desejados.has(k)) continue;
    const { count } = await admin
      .from("publication_executions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("target_id", t.id);
    if ((count ?? 0) > 0) {
      const { error } = await admin
        .from("publication_targets")
        .update({ metadata: { removed_at: new Date().toISOString() } })
        .eq("organization_id", orgId)
        .eq("id", t.id);
      if (error) throw new Error(`publicacoes_target_update_failed: ${error.message}`);
    } else {
      const { error } = await admin.from("publication_targets").delete().eq("organization_id", orgId).eq("id", t.id);
      if (error) throw new Error(`publicacoes_target_delete_failed: ${error.message}`);
    }
  }

  for (const [k, d] of desejados) {
    const atual = existentes.get(k);
    let targetId: string;
    if (atual) {
      targetId = atual.id;
      const { error } = await admin
        .from("publication_targets")
        .update({ settings: d.settings ?? {}, metadata: {} })
        .eq("organization_id", orgId)
        .eq("id", targetId);
      if (error) throw new Error(`publicacoes_target_update_failed: ${error.message}`);
    } else {
      const { data, error } = await admin
        .from("publication_targets")
        .insert({
          organization_id: orgId,
          publication_id: publicationId,
          channel_session_id: d.channel_session_id,
          network: d.network,
          format: d.format,
          settings: d.settings ?? {},
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`publicacoes_target_insert_failed: ${error?.message}`);
      targetId = data.id as string;
    }
    idPorChave.set(k, targetId);
    if (d.network === "whatsapp") {
      const { error: erroLimpa } = await admin
        .from("publication_target_groups")
        .delete()
        .eq("organization_id", orgId)
        .eq("target_id", targetId);
      if (erroLimpa) throw new Error(`publicacoes_target_groups_failed: ${erroLimpa.message}`);
      if (d.group_ids.length > 0) {
        const { error } = await admin.from("publication_target_groups").insert(
          d.group_ids.map((g) => ({
            organization_id: orgId,
            channel_session_id: d.channel_session_id,
            target_id: targetId,
            group_id: g,
          })),
        );
        if (error) throw new Error(`publicacoes_target_groups_insert_failed: ${error.message}`);
      }
    }
  }
  return idPorChave;
}

// ─── Editar ─────────────────────────────────────────────────────────────────

export async function alterarPublicacao(
  admin: AdminClient,
  ctx: ContextoDeEscrita,
  id: string,
  entrada: AlterarPublicacao,
): Promise<PublicacaoLida> {
  const agora = ctx.agora ?? new Date();
  const atual = await carregarPublicacao(admin, ctx.orgId, id);
  if (!atual) throw new ErroDePublicacao("not_found", "Publicação não encontrada.", 404);
  if (atual.status === "cancelled") {
    throw new ErroDePublicacao("invalid_state", "Uma publicação cancelada não pode ser editada.", 409);
  }

  const body = entrada.body !== undefined ? entrada.body : atual.body;
  const media = entrada.media ?? atual.media.map((m) => ({ ...m, kind: m.kind as MidiaDaPublicacao["kind"] }));
  const destinosEntrada =
    entrada.targets ??
    atual.targets
      .filter((t) => !t.removido)
      .map((t) => ({
        id: t.id,
        network: t.network,
        format: t.format,
        channel_session_id: t.channel_session_id,
        group_ids: t.group_ids,
        settings: t.settings as DestinoDaPublicacao["settings"],
      }));
  const statusNovo: StatusDaPublicacao = entrada.status ?? (atual.status === "completed" ? "scheduled" : atual.status);
  const recorrencia = entrada.recurrence ?? {
    kind: atual.recurrence.kind,
    config: atual.recurrence.config as Record<string, never>,
    repeat_until: atual.recurrence.repeat_until,
    max_occurrences: atual.recurrence.max_occurrences,
  };
  const timezone = entrada.timezone && fusoValido(entrada.timezone) ? entrada.timezone : atual.timezone;

  conferirMidia(ctx.orgId, media);
  const destinos = await conferirDestinos(admin, ctx.orgId, destinosEntrada);
  if (statusNovo === "scheduled") {
    if (destinos.length === 0) throw new ErroDePublicacao("publication_no_targets", "Escolha pelo menos um destino.", 422);
    conferirRegras(body, media, destinos);
  }

  const { error } = await admin
    .from("publications")
    .update({
      title: entrada.title !== undefined ? entrada.title : atual.title,
      body,
      status: statusNovo,
      timezone,
      recurrence_kind: recorrencia.kind,
      recurrence_config: recorrencia.config,
      repeat_until: recorrencia.repeat_until ?? null,
      max_occurrences: recorrencia.max_occurrences ?? null,
      updated_by: ctx.userId,
      ...(entrada.metadata ? { metadata: entrada.metadata } : {}),
    })
    .eq("organization_id", ctx.orgId)
    .eq("id", id);
  if (error) throw new Error(`publicacoes_update_failed: ${error.message}`);

  if (entrada.media) await gravarMidias(admin, ctx.orgId, id, media);
  // Sem `targets` no corpo os destinos são os atuais, e é preciso o id por chave do mesmo jeito.
  const idPorChave = entrada.targets
    ? await gravarDestinos(admin, ctx.orgId, id, destinos, atual.targets)
    : new Map(atual.targets.filter((t) => !t.removido).map((t) => [chaveDeDestino(t), t.id]));

  // Ocorrências pendentes: a lista manual nova substitui a antiga; a
  // recorrência pendente é regerada quando a regra ou as datas mudam.
  const trouxeDatas = entrada.occurrences !== undefined || entrada.scheduled_at !== undefined;
  const mudouAgenda = trouxeDatas || entrada.recurrence !== undefined || entrada.timezone !== undefined;
  if (mudouAgenda) {
    const horarios = trouxeDatas ? horariosDaEntrada(entrada) : null;
    const manuaisDesejadas = new Set(
      statusNovo === "scheduled"
        ? instantesValidos(horarios ? [...horarios.keys()] : atual.occurrences.filter((o) => o.source === "manual" && o.status === "pending").map((o) => o.scheduled_at), agora)
        : [...(horarios?.keys() ?? [])],
    );
    const pendentes = atual.occurrences.filter((o) => o.status === "pending");
    const remover = pendentes.filter((o) => o.source === "recurrence" || !manuaisDesejadas.has(new Date(o.scheduled_at).toISOString()));
    if (remover.length > 0) {
      const { error: erroDel } = await admin
        .from("publication_occurrences")
        .delete()
        .eq("organization_id", ctx.orgId)
        .in("id", remover.map((o) => o.id));
      if (erroDel) throw new Error(`publicacoes_occurrences_delete_failed: ${erroDel.message}`);
    }
    const mantidas = atual.occurrences.filter((o) => !remover.includes(o));
    const jaExistem = new Set(mantidas.map((o) => new Date(o.scheduled_at).toISOString()));
    const inserir = [...manuaisDesejadas].filter((d) => !jaExistem.has(d));
    let criadas: Array<{ id: string; scheduled_at: string }> = [];
    if (inserir.length > 0) {
      const { data, error: erroIns } = await admin
        .from("publication_occurrences")
        .insert(inserir.map((d) => ({ organization_id: ctx.orgId, publication_id: id, scheduled_at: d, source: "manual", status: "pending" })))
        .select("id, scheduled_at");
      if (erroIns) throw new Error(`publicacoes_occurrences_insert_failed: ${erroIns.message}`);
      criadas = (data ?? []) as Array<{ id: string; scheduled_at: string }>;
    }
    if (horarios) {
      // As pendentes manuais que ficaram e as novas recebem o subconjunto pedido.
      const pendentesManuais = mantidas.filter((o) => o.status === "pending" && o.source === "manual" && manuaisDesejadas.has(new Date(o.scheduled_at).toISOString()));
      await gravarDestinosDasOcorrencias(admin, ctx.orgId, [...pendentesManuais, ...criadas], horarios, idPorChave);
    }
  }
  if (statusNovo === "scheduled") {
    await materializarRecorrencia(
      admin,
      {
        id,
        organization_id: ctx.orgId,
        timezone,
        recurrence_kind: recorrencia.kind,
        recurrence_config: recorrencia.config,
        repeat_until: recorrencia.repeat_until ?? null,
        max_occurrences: recorrencia.max_occurrences ?? null,
      },
      agora,
    );
  }

  const lida = await carregarPublicacao(admin, ctx.orgId, id);
  if (!lida) throw new Error("publicacoes_reload_failed");
  return lida;
}

// ─── Cancelar / excluir ─────────────────────────────────────────────────────

async function cancelarPendentes(admin: AdminClient, orgId: string, publicationId: string, userId: string, agora: Date): Promise<number> {
  const { data: pend, error } = await admin
    .from("publication_occurrences")
    .select("id")
    .eq("organization_id", orgId)
    .eq("publication_id", publicationId)
    .eq("status", "pending");
  if (error) throw new Error(`publicacoes_cancel_failed: ${error.message}`);
  const ids = (pend ?? []).map((o) => o.id as string);
  if (ids.length === 0) return 0;
  const { error: e1 } = await admin
    .from("publication_occurrences")
    .update({ status: "cancelled", cancelled_at: agora.toISOString(), cancelled_by: userId, finished_at: agora.toISOString() })
    .eq("organization_id", orgId)
    .in("id", ids)
    .eq("status", "pending");
  if (e1) throw new Error(`publicacoes_cancel_failed: ${e1.message}`);
  const { error: e2 } = await admin
    .from("publication_executions")
    .update({ status: "cancelled", finished_at: agora.toISOString() })
    .eq("organization_id", orgId)
    .in("occurrence_id", ids)
    .eq("status", "pending");
  if (e2) throw new Error(`publicacoes_cancel_failed: ${e2.message}`);
  return ids.length;
}

export async function cancelarPublicacao(
  admin: AdminClient,
  ctx: ContextoDeEscrita,
  id: string,
  reason: string,
): Promise<PublicacaoLida> {
  const agora = ctx.agora ?? new Date();
  const atual = await carregarPublicacao(admin, ctx.orgId, id);
  if (!atual) throw new ErroDePublicacao("not_found", "Publicação não encontrada.", 404);
  if (atual.status === "cancelled") return atual;
  await cancelarPendentes(admin, ctx.orgId, id, ctx.userId, agora);
  const { error } = await admin
    .from("publications")
    .update({ status: "cancelled", cancelled_at: agora.toISOString(), cancelled_by: ctx.userId, cancel_reason: reason, updated_by: ctx.userId })
    .eq("organization_id", ctx.orgId)
    .eq("id", id);
  if (error) throw new Error(`publicacoes_cancel_failed: ${error.message}`);
  return (await carregarPublicacao(admin, ctx.orgId, id))!;
}

/** Soft-delete: some das telas, cancela o pendente, preserva a história. */
export async function excluirPublicacao(admin: AdminClient, ctx: ContextoDeEscrita, id: string): Promise<void> {
  const agora = ctx.agora ?? new Date();
  const atual = await carregarPublicacao(admin, ctx.orgId, id);
  if (!atual) throw new ErroDePublicacao("not_found", "Publicação não encontrada.", 404);
  await cancelarPendentes(admin, ctx.orgId, id, ctx.userId, agora);
  const { error } = await admin
    .from("publications")
    .update({ deleted_at: agora.toISOString(), deleted_by: ctx.userId, updated_by: ctx.userId })
    .eq("organization_id", ctx.orgId)
    .eq("id", id);
  if (error) throw new Error(`publicacoes_delete_failed: ${error.message}`);
}

// ─── Ocorrência: reagendar e cancelar ───────────────────────────────────────

export async function reagendarOcorrencia(
  admin: AdminClient,
  ctx: ContextoDeEscrita,
  occurrenceId: string,
  scheduledAt: string,
): Promise<OcorrenciaLida> {
  const agora = ctx.agora ?? new Date();
  const [novo] = instantesValidos([scheduledAt], agora);
  const { data: occ, error } = await admin
    .from("publication_occurrences")
    .select("id, publication_id, status")
    .eq("organization_id", ctx.orgId)
    .eq("id", occurrenceId)
    .maybeSingle();
  if (error) throw new Error(`publicacoes_occurrence_failed: ${error.message}`);
  if (!occ) throw new ErroDePublicacao("not_found", "Ocorrência não encontrada.", 404);
  if (occ.status !== "pending") {
    throw new ErroDePublicacao("publication_occurrence_closed", "Esta ocorrência já saiu (ou está saindo) e não pode ser reagendada.", 409);
  }
  const { data, error: erroUpd } = await admin
    .from("publication_occurrences")
    .update({ scheduled_at: novo, source: "manual" })
    .eq("organization_id", ctx.orgId)
    .eq("id", occurrenceId)
    .eq("status", "pending")
    .select("id, scheduled_at, source, status, skipped_reason, processed_at, finished_at")
    .maybeSingle();
  if (erroUpd) {
    if (erroUpd.code === "23505") {
      throw new ErroDePublicacao("validation_failed", "Esta publicação já tem uma ocorrência nesse horário.", 422);
    }
    throw new Error(`publicacoes_reschedule_failed: ${erroUpd.message}`);
  }
  if (!data) throw new ErroDePublicacao("publication_occurrence_closed", "Esta ocorrência já saiu e não pode ser reagendada.", 409);
  return data as unknown as OcorrenciaLida;
}

export async function cancelarOcorrencia(
  admin: AdminClient,
  ctx: ContextoDeEscrita,
  occurrenceId: string,
): Promise<OcorrenciaLida> {
  const agora = ctx.agora ?? new Date();
  const { data, error } = await admin
    .from("publication_occurrences")
    .update({ status: "cancelled", cancelled_at: agora.toISOString(), cancelled_by: ctx.userId, finished_at: agora.toISOString() })
    .eq("organization_id", ctx.orgId)
    .eq("id", occurrenceId)
    .eq("status", "pending")
    .select("id, publication_id, scheduled_at, source, status, skipped_reason, processed_at, finished_at")
    .maybeSingle();
  if (error) throw new Error(`publicacoes_occurrence_cancel_failed: ${error.message}`);
  if (!data) {
    throw new ErroDePublicacao("publication_occurrence_closed", "Esta ocorrência já saiu (ou está saindo) e não pode ser cancelada.", 409);
  }
  const { error: e2 } = await admin
    .from("publication_executions")
    .update({ status: "cancelled", finished_at: agora.toISOString() })
    .eq("organization_id", ctx.orgId)
    .eq("occurrence_id", occurrenceId)
    .eq("status", "pending");
  if (e2) throw new Error(`publicacoes_occurrence_cancel_failed: ${e2.message}`);
  // A publicação fecha se essa era a última pendente e a recorrência acabou.
  await admin.rpc("fn_rollup_publication_occurrence", { p_occurrence: occurrenceId });
  return data as unknown as OcorrenciaLida;
}

// ─── Listagens para a tela ──────────────────────────────────────────────────

export interface ResumoDeDestino {
  id: string;
  network: RedeDaPublicacao;
  format: FormatoDaPublicacao;
  channel_session_id: string;
  display_name: string | null;
  group_count: number;
  removido: boolean;
}

export interface ResumoDeExecucoes {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  sending: number;
  skipped: number;
  cancelled: number;
}

export interface OcorrenciaResumida extends OcorrenciaLida {
  publication_id: string;
  title: string | null;
  body: string | null;
  timezone: string;
  publication_status: StatusDaPublicacao;
  recurrence_kind: TipoDeRecorrencia;
  recurrence_config: Record<string, unknown>;
  thumb: { storage_path: string; kind: string; mime: string } | null;
  media_count: number;
  targets: ResumoDeDestino[];
  executions: ResumoDeExecucoes;
  /** O estado de cada destino DESTA data (id do destino → estado), para o chip do Calendário. */
  destinos_estado: Record<string, EstadoDoDestino>;
}

export async function listarOcorrencias(
  admin: AdminClient,
  orgId: string,
  filtros: { de: string; ate: string; incluir: "pendentes" | "todas"; limit: number },
): Promise<OcorrenciaResumida[]> {
  let q = admin
    .from("publication_occurrences")
    .select("id, publication_id, scheduled_at, source, status, skipped_reason, processed_at, finished_at")
    .eq("organization_id", orgId)
    .gte("scheduled_at", filtros.de)
    .lte("scheduled_at", filtros.ate)
    .order("scheduled_at", { ascending: true })
    .limit(filtros.limit);
  if (filtros.incluir === "pendentes") q = q.in("status", ["pending", "processing"]);
  const { data, error } = await q;
  if (error) throw new Error(`publicacoes_list_failed: ${error.message}`);
  return montarResumos(admin, orgId, (data ?? []) as unknown as Array<OcorrenciaLida & { publication_id: string }>);
}

export async function historicoDeOcorrencias(
  admin: AdminClient,
  orgId: string,
  filtros: { status?: StatusDaOcorrencia; network?: RedeDaPublicacao; de?: string; ate?: string; cursor?: string; limit: number },
): Promise<{ itens: OcorrenciaResumida[]; cursor: string | null; has_more: boolean }> {
  let q = admin
    .from("publication_occurrences")
    .select("id, publication_id, scheduled_at, source, status, skipped_reason, processed_at, finished_at")
    .eq("organization_id", orgId)
    .not("status", "in", "(pending,processing)")
    .order("scheduled_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(filtros.limit + 1);
  if (filtros.status) q = q.eq("status", filtros.status);
  if (filtros.de) q = q.gte("scheduled_at", filtros.de);
  if (filtros.ate) q = q.lte("scheduled_at", filtros.ate);
  if (filtros.cursor) {
    const c = decodificarCursor(filtros.cursor);
    if (c) q = q.or(`scheduled_at.lt.${c.scheduled_at},and(scheduled_at.eq.${c.scheduled_at},id.lt.${c.id})`);
  }
  const { data, error } = await q;
  if (error) throw new Error(`publicacoes_history_failed: ${error.message}`);
  const linhas = (data ?? []) as unknown as Array<OcorrenciaLida & { publication_id: string }>;
  const hasMore = linhas.length > filtros.limit;
  const pagina = hasMore ? linhas.slice(0, filtros.limit) : linhas;
  let itens = await montarResumos(admin, orgId, pagina);
  if (filtros.network) itens = itens.filter((o) => o.targets.some((t) => t.network === filtros.network));
  const ultimo = pagina[pagina.length - 1];
  return {
    itens,
    cursor: hasMore && ultimo ? codificarCursor({ scheduled_at: ultimo.scheduled_at, id: ultimo.id }) : null,
    has_more: hasMore,
  };
}

function codificarCursor(c: { scheduled_at: string; id: string }): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
function decodificarCursor(s: string): { scheduled_at: string; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as { scheduled_at?: unknown; id?: unknown };
    return typeof v.scheduled_at === "string" && typeof v.id === "string" ? { scheduled_at: v.scheduled_at, id: v.id } : null;
  } catch {
    return null;
  }
}

async function montarResumos(
  admin: AdminClient,
  orgId: string,
  ocorrencias: Array<OcorrenciaLida & { publication_id: string }>,
): Promise<OcorrenciaResumida[]> {
  if (ocorrencias.length === 0) return [];
  const pubIds = [...new Set(ocorrencias.map((o) => o.publication_id))];
  const occIds = ocorrencias.map((o) => o.id);
  const [pubs, medias, targets, grupos, execs] = await Promise.all([
    admin
      .from("publications")
      .select("id, title, body, timezone, status, recurrence_kind, recurrence_config, deleted_at")
      .eq("organization_id", orgId)
      .in("id", pubIds),
    admin
      .from("publication_media")
      .select("publication_id, storage_path, kind, mime, position")
      .eq("organization_id", orgId)
      .in("publication_id", pubIds)
      .order("position", { ascending: true }),
    admin
      .from("publication_targets")
      .select("id, publication_id, network, format, channel_session_id, metadata, channel_sessions!publication_targets_channel_org_fkey(display_name, phone_number)")
      .eq("organization_id", orgId)
      .in("publication_id", pubIds),
    admin.from("publication_target_groups").select("target_id").eq("organization_id", orgId),
    admin
      .from("publication_executions")
      .select("occurrence_id, target_id, group_id, media_id, attempt, status, retry_at")
      .eq("organization_id", orgId)
      .in("occurrence_id", occIds),
  ]);
  for (const r of [pubs, medias, targets, grupos, execs]) {
    if (r.error) throw new Error(`publicacoes_list_failed: ${r.error.message}`);
  }
  const destinosPorOcorrencia = await destinosDasOcorrencias(admin, orgId, occIds);
  const pubPorId = new Map(((pubs.data ?? []) as unknown as Array<Record<string, unknown>>).map((p) => [p.id as string, p]));
  const thumbPorPub = new Map<string, { storage_path: string; kind: string; mime: string }>();
  const contagemDeMidia = new Map<string, number>();
  for (const m of (medias.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const pid = m.publication_id as string;
    contagemDeMidia.set(pid, (contagemDeMidia.get(pid) ?? 0) + 1);
    if (!thumbPorPub.has(pid) && (m.kind === "image" || m.kind === "video")) {
      thumbPorPub.set(pid, { storage_path: m.storage_path as string, kind: m.kind as string, mime: m.mime as string });
    }
  }
  const gruposPorTarget = new Map<string, number>();
  for (const g of (grupos.data ?? []) as Array<{ target_id: string }>) {
    gruposPorTarget.set(g.target_id, (gruposPorTarget.get(g.target_id) ?? 0) + 1);
  }
  const targetsPorPub = new Map<string, ResumoDeDestino[]>();
  for (const t of (targets.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const pid = t.publication_id as string;
    const sessao = t.channel_sessions as { display_name: string | null; phone_number: string | null } | null;
    const meta = (t.metadata as Record<string, unknown>) ?? {};
    const lista = targetsPorPub.get(pid) ?? [];
    lista.push({
      id: t.id as string,
      network: t.network as RedeDaPublicacao,
      format: t.format as FormatoDaPublicacao,
      channel_session_id: t.channel_session_id as string,
      display_name: sessao?.display_name ?? sessao?.phone_number ?? null,
      group_count: gruposPorTarget.get(t.id as string) ?? 0,
      removido: typeof meta.removed_at === "string",
    });
    targetsPorPub.set(pid, lista);
  }
  const execPorOcc = new Map<string, ResumoDeExecucoes>();
  const execsPorOcc = new Map<string, ExecucaoParaEstado[]>();
  for (const e of (execs.data ?? []) as Array<ExecucaoParaEstado & { occurrence_id: string }>) {
    const lista = execsPorOcc.get(e.occurrence_id) ?? [];
    lista.push(e);
    execsPorOcc.set(e.occurrence_id, lista);
  }
  for (const e of (execs.data ?? []) as Array<{ occurrence_id: string; status: StatusDaExecucao }>) {
    const r = execPorOcc.get(e.occurrence_id) ?? { total: 0, sent: 0, failed: 0, pending: 0, sending: 0, skipped: 0, cancelled: 0 };
    r.total += 1;
    r[e.status] += 1;
    execPorOcc.set(e.occurrence_id, r);
  }
  const saida: OcorrenciaResumida[] = [];
  for (const o of ocorrencias) {
    const p = pubPorId.get(o.publication_id);
    if (!p || p.deleted_at) continue;
    // Só os destinos DESTA data (0284): sem escolha, todos.
    const destinosDaData = (targetsPorPub.get(o.publication_id) ?? []).filter((t) => {
      const desta = destinosPorOcorrencia.get(o.id);
      if (desta && !desta.includes(t.id)) return false;
      return !t.removido || o.status !== "pending";
    });
    saida.push({
      ...o,
      title: (p.title as string | null) ?? null,
      body: (p.body as string | null) ?? null,
      timezone: p.timezone as string,
      publication_status: p.status as StatusDaPublicacao,
      recurrence_kind: p.recurrence_kind as TipoDeRecorrencia,
      recurrence_config: (p.recurrence_config as Record<string, unknown>) ?? {},
      thumb: thumbPorPub.get(o.publication_id) ?? null,
      media_count: contagemDeMidia.get(o.publication_id) ?? 0,
      target_ids: destinosPorOcorrencia.get(o.id) ?? null,
      // Só os destinos DESTA data (0284): sem linha, todos.
      targets: destinosDaData,
      destinos_estado: estadosDosDestinos(o.status, destinosDaData.map((t) => t.id), execsPorOcc.get(o.id) ?? []),
      executions: execPorOcc.get(o.id) ?? { total: 0, sent: 0, failed: 0, pending: 0, sending: 0, skipped: 0, cancelled: 0 },
    });
  }
  return saida;
}

// ─── Detalhe de uma ocorrência (Sheet e Histórico) ──────────────────────────

export interface ExecucaoLida {
  id: string;
  target_id: string;
  group_id: string | null;
  media_id: string | null;
  position: number;
  attempt: number;
  status: StatusDaExecucao;
  external_post_id: string | null;
  external_url: string | null;
  provider_status: string | null;
  error_code: string | null;
  error_category: string | null;
  error_message: string | null;
  retry_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  group_name: string | null;
}

export async function detalheDaOcorrencia(
  admin: AdminClient,
  orgId: string,
  occurrenceId: string,
): Promise<{ occurrence: OcorrenciaResumida; publication: PublicacaoLida; executions: ExecucaoLida[] } | null> {
  const { data: occ, error } = await admin
    .from("publication_occurrences")
    .select("id, publication_id, scheduled_at, source, status, skipped_reason, processed_at, finished_at")
    .eq("organization_id", orgId)
    .eq("id", occurrenceId)
    .maybeSingle();
  if (error) throw new Error(`publicacoes_occurrence_failed: ${error.message}`);
  if (!occ) return null;
  const o = occ as unknown as OcorrenciaLida & { publication_id: string };
  const [resumos, publication, execs] = await Promise.all([
    montarResumos(admin, orgId, [o]),
    carregarPublicacao(admin, orgId, o.publication_id, { incluirExcluida: true }),
    admin
      .from("publication_executions")
      .select(
        "id, target_id, group_id, media_id, position, attempt, status, external_post_id, external_url, provider_status, error_code, error_category, error_message, retry_at, started_at, finished_at, created_at, scheduled_whatsapp_groups(name)",
      )
      .eq("organization_id", orgId)
      .eq("occurrence_id", occurrenceId)
      .order("position", { ascending: true })
      .order("attempt", { ascending: true }),
  ]);
  if (execs.error) throw new Error(`publicacoes_executions_failed: ${execs.error.message}`);
  if (!publication || !resumos[0]) return null;
  return {
    occurrence: resumos[0],
    publication,
    executions: ((execs.data ?? []) as unknown as Array<Record<string, unknown>>).map((e) => ({
      id: e.id as string,
      target_id: e.target_id as string,
      group_id: (e.group_id as string | null) ?? null,
      media_id: (e.media_id as string | null) ?? null,
      position: Number(e.position),
      attempt: e.attempt as number,
      status: e.status as StatusDaExecucao,
      external_post_id: (e.external_post_id as string | null) ?? null,
      external_url: (e.external_url as string | null) ?? null,
      provider_status: (e.provider_status as string | null) ?? null,
      error_code: (e.error_code as string | null) ?? null,
      error_category: (e.error_category as string | null) ?? null,
      error_message: (e.error_message as string | null) ?? null,
      retry_at: (e.retry_at as string | null) ?? null,
      started_at: (e.started_at as string | null) ?? null,
      finished_at: (e.finished_at as string | null) ?? null,
      created_at: e.created_at as string,
      group_name: ((e.scheduled_whatsapp_groups as { name: string } | null)?.name as string | undefined) ?? null,
    })),
  };
}

// ─── Reenviar à mão ─────────────────────────────────────────────────────────

/**
 * Cria `attempt+1` para uma execução terminal (falhou, ficou presa, foi
 * pulada) por decisão explícita de uma pessoa. É o ÚNICO caminho de reenvio
 * no WhatsApp — o worker nunca reenvia sozinho o que já chegou a `sending`.
 */
export async function reenviarExecucao(
  admin: AdminClient,
  ctx: ContextoDeEscrita,
  executionId: string,
): Promise<{ id: string; attempt: number }> {
  const { data: e, error } = await admin
    .from("publication_executions")
    .select("id, publication_id, occurrence_id, target_id, group_id, media_id, position, attempt, status")
    .eq("organization_id", ctx.orgId)
    .eq("id", executionId)
    .maybeSingle();
  if (error) throw new Error(`publicacoes_execution_failed: ${error.message}`);
  if (!e) throw new ErroDePublicacao("not_found", "Execução não encontrada.", 404);
  if (e.status !== "failed" && e.status !== "skipped" && e.status !== "cancelled") {
    throw new ErroDePublicacao("invalid_state", "Só o que falhou, foi pulado ou cancelado pode ser reenviado.", 409);
  }
  const { data: maior } = await admin
    .from("publication_executions")
    .select("attempt")
    .eq("organization_id", ctx.orgId)
    .eq("occurrence_id", e.occurrence_id)
    .eq("target_id", e.target_id)
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  const attempt = ((maior as { attempt?: number } | null)?.attempt ?? e.attempt) + 1;
  const { data: nova, error: erroIns } = await admin
    .from("publication_executions")
    .insert({
      organization_id: ctx.orgId,
      publication_id: e.publication_id,
      occurrence_id: e.occurrence_id,
      target_id: e.target_id,
      group_id: e.group_id,
      media_id: e.media_id,
      position: e.position,
      attempt,
      status: "pending",
      metadata: { resent_by: ctx.userId, resent_from: e.id },
    })
    .select("id, attempt")
    .single();
  if (erroIns || !nova) throw new Error(`publicacoes_resend_failed: ${erroIns?.message}`);
  // A ocorrência volta a "processing" até o worker fechar de novo.
  await admin
    .from("publication_occurrences")
    .update({ status: "processing", finished_at: null })
    .eq("organization_id", ctx.orgId)
    .eq("id", e.occurrence_id);
  return { id: nova.id as string, attempt: nova.attempt as number };
}
