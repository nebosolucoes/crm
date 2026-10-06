"use client";

/**
 * A camada de dados das telas de Publicações: TanStack Query + `apiClient`
 * (que carimba `X-Request-Id` e uma `Idempotency-Key` por POST). As chaves de
 * cache são invalidadas em bloco depois de qualquer escrita; o realtime nas
 * ocorrências e execuções faz o mesmo (ver `useRealtimeDePublicacoes`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { apiClient } from "@/lib/api/client";
import type { PromptDeLegenda, PromptsDaOrganizacao } from "@/lib/publicacoes/legenda/instrucoes";
import type { LegendaSugerida } from "@/lib/publicacoes/legenda/sugerir";
import type { AlterarPublicacao, CriarPublicacao, FormatoDaPublicacao, MidiaDaPublicacao, StatusDaOcorrencia, RedeDaPublicacao } from "@/lib/publicacoes/schema";
import type {
  ContaPublicavel,
  ExecucaoLida,
  OcorrenciaLida,
  OcorrenciaResumida,
  PublicacaoLida,
} from "@/lib/publicacoes/servico";

const BASE = "/api/v1/publicacoes";
export const CHAVE_DE_PUBLICACOES = ["publicacoes"] as const;

type Envelope<T> = { data: T; meta?: { cursor?: string; has_more?: boolean } };

export function useContasPublicaveis() {
  return useQuery({
    queryKey: [...CHAVE_DE_PUBLICACOES, "contas"],
    queryFn: async () => (await apiClient.get<Envelope<ContaPublicavel[]>>(`${BASE}/contas`)).data,
    staleTime: 60_000,
  });
}

export function useOcorrencias(intervalo: { de: string; ate: string; incluir?: "pendentes" | "todas" } | null) {
  const qs = intervalo ? new URLSearchParams({ de: intervalo.de, ate: intervalo.ate, incluir: intervalo.incluir ?? "pendentes", limit: "1000" }).toString() : "";
  return useQuery({
    queryKey: [...CHAVE_DE_PUBLICACOES, "ocorrencias", qs],
    queryFn: async () => (await apiClient.get<Envelope<OcorrenciaResumida[]>>(`${BASE}/ocorrencias?${qs}`)).data,
    enabled: intervalo !== null,
    staleTime: 15_000,
  });
}

export function useHistorico(filtros: { status?: StatusDaOcorrencia; network?: RedeDaPublicacao; cursor?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filtros.status) params.set("status", filtros.status);
  if (filtros.network) params.set("network", filtros.network);
  if (filtros.cursor) params.set("cursor", filtros.cursor);
  params.set("limit", String(filtros.limit ?? 50));
  const qs = params.toString();
  return useQuery({
    queryKey: [...CHAVE_DE_PUBLICACOES, "historico", qs],
    queryFn: async () => {
      const r = await apiClient.get<Envelope<OcorrenciaResumida[]>>(`${BASE}/historico?${qs}`);
      return { itens: r.data, cursor: r.meta?.cursor ?? null, has_more: r.meta?.has_more ?? false };
    },
    staleTime: 15_000,
  });
}

export function useDetalheDaOcorrencia(id: string | null) {
  return useQuery({
    queryKey: [...CHAVE_DE_PUBLICACOES, "ocorrencia", id],
    queryFn: async () =>
      (await apiClient.get<Envelope<{ occurrence: OcorrenciaResumida; publication: PublicacaoLida; executions: ExecucaoLida[] }>>(`${BASE}/ocorrencias/${id}`)).data,
    enabled: id !== null,
    staleTime: 5_000,
  });
}

export function usePublicacao(id: string | null) {
  return useQuery({
    queryKey: [...CHAVE_DE_PUBLICACOES, "publicacao", id],
    queryFn: async () => (await apiClient.get<Envelope<PublicacaoLida>>(`${BASE}/${id}`)).data,
    enabled: id !== null,
  });
}

export function useRascunhos() {
  return useQuery({
    queryKey: [...CHAVE_DE_PUBLICACOES, "rascunhos"],
    queryFn: async () => (await apiClient.get<Envelope<Array<{ id: string; title: string | null; body: string | null; updated_at: string }>>>(`${BASE}?status=draft&limit=50`)).data,
    staleTime: 15_000,
  });
}

export function useMutacoesDePublicacao() {
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: CHAVE_DE_PUBLICACOES });

  const criar = useMutation({
    mutationFn: async (entrada: CriarPublicacao) => (await apiClient.post<Envelope<PublicacaoLida>>(BASE, entrada, { timeoutMs: 30_000 })).data,
    onSuccess: invalidar,
  });
  const editar = useMutation({
    mutationFn: async ({ id, entrada }: { id: string; entrada: AlterarPublicacao }) =>
      (await apiClient.patch<Envelope<PublicacaoLida>>(`${BASE}/${id}`, entrada, { timeoutMs: 30_000 })).data,
    onSuccess: invalidar,
  });
  const cancelar = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => (await apiClient.post<Envelope<PublicacaoLida>>(`${BASE}/${id}/cancelar`, { reason })).data,
    onSuccess: invalidar,
  });
  const excluir = useMutation({
    mutationFn: async (id: string) => apiClient.delete<unknown>(`${BASE}/${id}`),
    onSuccess: invalidar,
  });
  const reagendar = useMutation({
    mutationFn: async ({ id, scheduled_at }: { id: string; scheduled_at: string }) =>
      (await apiClient.patch<Envelope<OcorrenciaLida>>(`${BASE}/ocorrencias/${id}`, { scheduled_at })).data,
    onSuccess: invalidar,
  });
  const cancelarOcorrencia = useMutation({
    mutationFn: async (id: string) => (await apiClient.post<Envelope<OcorrenciaLida>>(`${BASE}/ocorrencias/${id}/cancelar`, {})).data,
    onSuccess: invalidar,
  });
  const reenviar = useMutation({
    mutationFn: async (executionId: string) => (await apiClient.post<Envelope<{ id: string; attempt: number }>>(`${BASE}/execucoes/${executionId}/reenviar`, {})).data,
    onSuccess: invalidar,
  });
  return { criar, editar, cancelar, excluir, reagendar, cancelarOcorrencia, reenviar, invalidar };
}

/** Sobe UM arquivo e devolve o descritor que vai em `media[]`. Dicas de dimensão/duração lidas no navegador. */
export async function subirMidia(
  file: File,
  dicas: { width?: number | null; height?: number | null; duration_ms?: number | null } = {},
): Promise<MidiaDaPublicacao> {
  const form = new FormData();
  form.append("file", file);
  if (dicas.width) form.append("width", String(dicas.width));
  if (dicas.height) form.append("height", String(dicas.height));
  if (dicas.duration_ms) form.append("duration_ms", String(dicas.duration_ms));
  const res = await fetch(`${BASE}/media`, { method: "POST", body: form });
  const json = (await res.json().catch(() => null)) as { data?: { media: MidiaDaPublicacao }; error?: { message?: string } } | null;
  if (!res.ok || !json?.data) throw new Error(json?.error?.message ?? "Não foi possível subir o arquivo.");
  return json.data.media;
}

const CHAVE_DOS_PROMPTS = [...CHAVE_DE_PUBLICACOES, "prompts-de-legenda"] as const;

/** Os prompts de legenda da organização, com as contas de cada um, e o padrão de cada rede. */
export function usePromptsDeLegenda() {
  return useQuery({
    queryKey: CHAVE_DOS_PROMPTS,
    queryFn: async () => (await apiClient.get<Envelope<PromptsDaOrganizacao>>(`${BASE}/prompts-de-legenda`)).data,
    staleTime: 60_000,
  });
}

/** Criar, alterar e apagar prompt. Toda escrita relê a lista: mover conta muda DOIS prompts. */
export function useMutacoesDePrompt() {
  const qc = useQueryClient();
  const reler = () => qc.invalidateQueries({ queryKey: CHAVE_DOS_PROMPTS });
  const criar = useMutation({
    mutationFn: async (entrada: { name: string; instructions: string; channel_session_ids: string[] }) =>
      (await apiClient.post<Envelope<PromptDeLegenda>>(`${BASE}/prompts-de-legenda`, entrada)).data,
    onSuccess: reler,
  });
  const alterar = useMutation({
    mutationFn: async ({ id, ...entrada }: { id: string; name?: string; instructions?: string; channel_session_ids?: string[] }) =>
      (await apiClient.patch<Envelope<PromptDeLegenda>>(`${BASE}/prompts-de-legenda/${id}`, entrada)).data,
    onSuccess: reler,
  });
  const excluir = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete<Envelope<{ id: string }>>(`${BASE}/prompts-de-legenda/${id}`)).data,
    onSuccess: reler,
  });
  return { criar, alterar, excluir };
}

/** Falha do Sugerir legenda, com o código que a tela usa para escolher o conserto. */
export class FalhaDaLegenda extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/**
 * Pede a legenda à IA. `fetch` direto, e não `apiClient`, de propósito: o
 * cliente repete sozinho em 429, e aqui o 429 é o teto de custo dizendo "espere"
 * — repetir em silêncio deixaria o botão girando um minuto inteiro.
 */
export async function sugerirLegendaComIa(entrada: {
  prompt_id?: string;
  network?: RedeDaPublicacao;
  destinos: Array<{ network: RedeDaPublicacao; format: FormatoDaPublicacao }>;
  idea: string;
  media_paths: string[];
  ignored_videos: number;
}): Promise<LegendaSugerida> {
  const res = await fetch(`${BASE}/legenda/sugerir`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(entrada),
  });
  const json = (await res.json().catch(() => null)) as { data?: LegendaSugerida; error?: { code?: string; message?: string } } | null;
  if (!res.ok || !json?.data) {
    throw new FalhaDaLegenda(json?.error?.code ?? `http_${res.status}`, json?.error?.message ?? "Não foi possível sugerir a legenda.");
  }
  return json.data;
}

export async function urlAssinadaDaMidia(storagePath: string): Promise<string | null> {
  try {
    const r = await apiClient.get<Envelope<{ url: string }>>(`${BASE}/media/url?storage_path=${encodeURIComponent(storagePath)}`);
    return r.data.url;
  } catch {
    return null;
  }
}

/**
 * Assina as duas tabelas publicadas no realtime (0283) e invalida o cache com
 * um debounce curto — a tela muda sozinha quando o worker fecha uma execução.
 */
export function useRealtimeDePublicacoes(enabled = true) {
  const org = useActiveOrg();
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: CHAVE_DE_PUBLICACOES }), 400);
  }, [qc]);
  const orgId = org?.orgId ?? "";
  const a = useRealtimeChannel({
    name: `publicacoes-ocorrencias-${orgId}`,
    postgresChanges: { event: "*", schema: "public", table: "publication_occurrences", filter: `organization_id=eq.${orgId}` },
    onChange: invalidar,
    enabled: enabled && orgId.length > 0,
  });
  const b = useRealtimeChannel({
    name: `publicacoes-execucoes-${orgId}`,
    postgresChanges: { event: "*", schema: "public", table: "publication_executions", filter: `organization_id=eq.${orgId}` },
    onChange: invalidar,
    enabled: enabled && orgId.length > 0,
  });
  return { status: a.status === "subscribed" && b.status === "subscribed" ? "subscribed" : a.status, ultimaEntrega: a.ultimaEntrega };
}
