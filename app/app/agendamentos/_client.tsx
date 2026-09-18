"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PreviaDoCelular, type AnexoDaPrevia } from "@/components/disparo/PreviaDoCelular";
import { SeletorDeGrupos } from "@/components/disparo/SeletorDeGrupos";
import { formatBytes } from "@/components/inbox/media/media-utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAXIMO_DE_ARQUIVOS_POR_DISPARO } from "@/lib/agendamentos-grupos/schema";
import { apiClient } from "@/lib/api/client";
import { randomId } from "@/lib/random-id";
import { capabilitiesOf } from "@/lib/channels/capabilities";
import type { ChannelProvider } from "@/lib/channels/types";
import {
  ArrowsClockwise,
  CalendarDots,
  CaretDown,
  CaretUp,
  CheckCircle,
  FileText,
  ImageSquare,
  MusicNote,
  Paperclip,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Trash,
  VideoCamera,
  Warning,
  X,
} from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

type StatusAgendamento = "draft" | "scheduled" | "paused" | "cancelled" | "completed";
type Recorrencia = "none" | "daily" | "weekly" | "monthly" | "custom";
type StatusExecucao = "pending" | "sending" | "sent" | "failed" | "skipped" | "cancelled";

type TipoDeAnexo = "image" | "video" | "audio" | "document";

interface MidiaAgendada {
  kind: TipoDeAnexo;
  storage_path: string;
  mime: string;
  size_bytes: number;
  filename?: string | null;
}

/**
 * Um anexo na tela: ou um arquivo recém-escolhido (`file`, ainda não enviado)
 * ou um já gravado no agendamento (`salvo`). A `url` é o que a prévia do
 * celular mostra — object URL local para o primeiro caso, URL assinada curta
 * (rota `/media/url`) para o segundo; `null` enquanto não há o que mostrar.
 */
interface AnexoLocal {
  id: string;
  kind: TipoDeAnexo;
  nome: string;
  mime: string;
  sizeBytes: number;
  file: File | null;
  salvo: MidiaAgendada | null;
  url: string | null;
}

interface LoteDeDisparo {
  id: string;
  size: number;
  index: number;
}

interface UltimaExecucao {
  id: string;
  scheduled_for: string;
  status: StatusExecucao;
  attempt: number;
  sent_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface GrupoSalvo {
  id: string;
  channel_session_id: string;
  external_group_id: string;
  name: string;
  is_active: boolean;
  last_seen_at: string | null;
  metadata?: Record<string, unknown> | null;
}

interface GrupoEncontrado {
  externalId: string;
  name: string;
  groupKind: "group" | "community" | "announcement";
  participantCount: number | null;
}

interface Agendamento {
  id: string;
  channel_session_id: string;
  group_id: string;
  title: string | null;
  body: string;
  status: StatusAgendamento;
  starts_at: string;
  timezone: string;
  recurrence_kind: Recorrencia;
  recurrence_config: Record<string, unknown>;
  repeat_until: string | null;
  max_runs: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  media: MidiaAgendada | null;
  media_items?: MidiaAgendada[];
  batch?: LoteDeDisparo | null;
  latest_execution: UltimaExecucao | null;
  scheduled_whatsapp_groups?: { name: string | null; external_group_id: string | null } | null;
}

interface Execucao {
  id: string;
  scheduled_message_id: string;
  scheduled_for: string;
  status: StatusExecucao;
  sent_at: string | null;
  error_code: string | null;
  error_message: string | null;
  scheduled_group_messages?: { title: string | null; body: string | null } | null;
  scheduled_whatsapp_groups?: { name: string | null; external_group_id: string | null } | null;
}

interface ChannelSession {
  id: string;
  display_name?: string | null;
  name?: string | null;
  phone_number?: string | null;
  provider?: string | null;
  status?: string | null;
}

type Aba = "agendar" | "agendamentos" | "grupos" | "historico";

const STATUS_LABEL: Record<StatusAgendamento, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  paused: "Pausado",
  cancelled: "Cancelado",
  completed: "Concluído",
};

const EXECUCAO_LABEL: Record<StatusExecucao, string> = {
  pending: "Pendente",
  sending: "Enviando",
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Ignorado",
  cancelled: "Cancelado",
};

function agoraLocal(): string {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  const dois = (numero: number) => String(numero).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

function isoDeInput(value: string): string {
  return new Date(value).toISOString();
}

function inputDeIso(value: string): string {
  const data = new Date(value);
  const dois = (numero: number) => String(numero).padStart(2, "0");
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}T${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

function dataCurta(value: string | null, tagDoIdioma: string, vazio: string): string {
  if (!value) return vazio;
  return new Intl.DateTimeFormat(tagDoIdioma, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function nomeDaConexao(c: ChannelSession): string {
  return (
    c.display_name?.trim() ||
    c.name?.trim() ||
    c.phone_number?.trim() ||
    c.provider?.trim() ||
    `Conexão ${c.id.slice(0, 8)}`
  );
}

function conexaoTemGrupos(c: ChannelSession): boolean {
  if (!c.provider) return false;
  return capabilitiesOf(c.provider as ChannelProvider).groups !== "none";
}

/** O tipo que a tela dá a um arquivo escolhido — a mesma régua da API (`validateOutboundMedia`). */
function tipoDoArquivo(mime: string): TipoDeAnexo {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "audio";
  return "document";
}

function horaDoInput(value: string): string {
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return "--:--";
  const dois = (numero: number) => String(numero).padStart(2, "0");
  return `${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

function legendaDaData(value: string, tagDoIdioma: string, hoje: string): string {
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return hoje;
  const agora = new Date();
  const mesmoDia =
    data.getFullYear() === agora.getFullYear() &&
    data.getMonth() === agora.getMonth() &&
    data.getDate() === agora.getDate();
  if (mesmoDia) return hoje;
  return new Intl.DateTimeFormat(tagDoIdioma, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data);
}

function badgeStatus(status: StatusAgendamento) {
  if (status === "scheduled") return "default";
  if (status === "paused" || status === "draft") return "secondary";
  if (status === "completed") return "outline";
  return "destructive";
}

function badgeExecucao(status: StatusExecucao) {
  if (status === "sent") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function AgendamentosClient({
  podeEditar,
  abaInicial = "agendar",
}: {
  podeEditar: boolean;
  abaInicial?: Aba;
}) {
  const aba = abaInicial;
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const orgId = useActiveOrg()?.orgId ?? null;
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [buscandoGrupos, setBuscandoGrupos] = useState(false);
  const [filtroGrupos, setFiltroGrupos] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [conexoes, setConexoes] = useState<ChannelSession[]>([]);
  const [grupos, setGrupos] = useState<GrupoSalvo[]>([]);
  const [gruposEncontrados, setGruposEncontrados] = useState<GrupoEncontrado[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);

  const [grupoConexaoId, setGrupoConexaoId] = useState("");

  const [gruposSelecionados, setGruposSelecionados] = useState<string[]>([]);
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [quando, setQuando] = useState(agoraLocal);
  const [status, setStatus] = useState<"scheduled" | "draft">("scheduled");
  const [recorrencia, setRecorrencia] = useState<Recorrencia>("none");
  const [intervaloCustom, setIntervaloCustom] = useState("60");
  const [maxRuns, setMaxRuns] = useState("");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [anexos, setAnexos] = useState<AnexoLocal[]>([]);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const inputMidiaRef = useRef<HTMLInputElement>(null);
  /** Object URLs vivas, para revogar ao remover o anexo e ao desmontar. */
  const urlsLocaisRef = useRef<Map<string, string>>(new Map());
  const router = useRouter();
  const searchParams = useSearchParams();
  const editandoIdNaUrl = searchParams.get("editar");

  const conexoesComGrupos = useMemo(() => conexoes.filter(conexaoTemGrupos), [conexoes]);

  const gruposEscolhidos = useMemo(
    () =>
      gruposSelecionados
        .map((id) => grupos.find((g) => g.id === id))
        .filter((g): g is GrupoSalvo => !!g),
    [gruposSelecionados, grupos],
  );
  const grupoSelecionado = gruposEscolhidos[0] ?? null;

  const gruposEncontradosVisiveis = useMemo(() => {
    const filtro = filtroGrupos.trim().toLocaleLowerCase();
    if (!filtro) return gruposEncontrados;
    return gruposEncontrados.filter((grupo) => grupo.name.toLocaleLowerCase().includes(filtro));
  }, [filtroGrupos, gruposEncontrados]);

  const conexaoDoGrupo = useMemo(
    () => conexoes.find((c) => c.id === grupoSelecionado?.channel_session_id) ?? null,
    [conexoes, grupoSelecionado],
  );

  const revogarUrlLocal = useCallback((id: string) => {
    const url = urlsLocaisRef.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urlsLocaisRef.current.delete(id);
  }, []);

  function limparAnexos() {
    for (const id of [...urlsLocaisRef.current.keys()]) revogarUrlLocal(id);
    setAnexos([]);
    if (inputMidiaRef.current) inputMidiaRef.current.value = "";
  }

  function preencherFormulario(agendamento: Agendamento) {
    setEditandoId(agendamento.id);
    setGruposSelecionados([agendamento.group_id]);
    setTitulo(agendamento.title ?? "");
    setMensagem(agendamento.body);
    setQuando(inputDeIso(agendamento.starts_at));
    setStatus(agendamento.status === "draft" ? "draft" : "scheduled");
    setRecorrencia(agendamento.recurrence_kind);
    setIntervaloCustom(String(agendamento.recurrence_config.interval_minutes ?? 60));
    setMaxRuns(agendamento.max_runs === null ? "" : String(agendamento.max_runs));
    setRepeatUntil(agendamento.repeat_until ? inputDeIso(agendamento.repeat_until) : "");
    limparAnexos();
    const salvos = agendamento.media_items ?? (agendamento.media ? [agendamento.media] : []);
    setAnexos(
      salvos.map((m) => ({
        id: `salvo-${m.storage_path}`,
        kind: m.kind,
        nome: m.filename ?? m.storage_path.split("/").pop() ?? m.kind,
        mime: m.mime,
        sizeBytes: m.size_bytes,
        file: null,
        salvo: m,
        url: null,
      })),
    );
  }

  function removerAnexo(id: string) {
    revogarUrlLocal(id);
    setAnexos((atuais) => atuais.filter((a) => a.id !== id));
    if (inputMidiaRef.current) inputMidiaRef.current.value = "";
  }

  function moverAnexo(id: string, direcao: -1 | 1) {
    setAnexos((atuais) => {
      const i = atuais.findIndex((a) => a.id === id);
      const j = i + direcao;
      if (i < 0 || j < 0 || j >= atuais.length) return atuais;
      const proximo = [...atuais];
      [proximo[i], proximo[j]] = [proximo[j]!, proximo[i]!];
      return proximo;
    });
  }

  function adicionarArquivos(lista: FileList | File[] | null) {
    if (!lista) return;
    const arquivos = [...lista];
    if (arquivos.length === 0) return;
    const vagas = MAXIMO_DE_ARQUIVOS_POR_DISPARO - anexos.length;
    if (vagas <= 0) {
      toast.error(`Um disparo leva no máximo ${MAXIMO_DE_ARQUIVOS_POR_DISPARO} arquivos.`);
      return;
    }
    const aceitos: AnexoLocal[] = [];
    for (const file of arquivos.slice(0, vagas)) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`${file.name}: o arquivo deve ter no máximo 50 MB.`);
        continue;
      }
      if (file.size === 0) {
        toast.error(`${file.name}: arquivo vazio.`);
        continue;
      }
      const kind = tipoDoArquivo(file.type || "application/octet-stream");
      const id = `novo-${randomId()}`;
      let url: string | null = null;
      if (kind === "image" || kind === "video") {
        url = URL.createObjectURL(file);
        urlsLocaisRef.current.set(id, url);
      }
      aceitos.push({
        id,
        kind,
        nome: file.name,
        mime: file.type || "application/octet-stream",
        sizeBytes: file.size,
        file,
        salvo: null,
        url,
      });
    }
    if (arquivos.length > vagas) {
      toast.error(
        `Só ${vagas} arquivo(s) cabem: o máximo por disparo é ${MAXIMO_DE_ARQUIVOS_POR_DISPARO}.`,
      );
    }
    if (aceitos.length > 0) setAnexos((atuais) => [...atuais, ...aceitos]);
    if (inputMidiaRef.current) inputMidiaRef.current.value = "";
  }

  function limparFormulario() {
    setEditandoId(null);
    setGruposSelecionados([]);
    setTitulo("");
    setMensagem("");
    setQuando(agoraLocal());
    setStatus("scheduled");
    setRecorrencia("none");
    setIntervaloCustom("60");
    setMaxRuns("");
    setRepeatUntil("");
    limparAnexos();
  }

  useEffect(
    () => () => {
      for (const url of urlsLocaisRef.current.values()) URL.revokeObjectURL(url);
      urlsLocaisRef.current.clear();
    },
    [],
  );

  // Anexo já gravado é só um caminho no bucket privado: a prévia pede uma URL
  // assinada curta para foto e vídeo. Documento e áudio se mostram sem ela.
  useEffect(() => {
    const pendentes = anexos.filter(
      (a) => a.salvo && a.url === null && (a.kind === "image" || a.kind === "video"),
    );
    if (pendentes.length === 0) return;
    let cancelado = false;
    void Promise.all(
      pendentes.map(async (a) => {
        try {
          const r = await apiClient.get<{ data: { url: string } }>(
            `/api/v1/agendamentos/media/url?storage_path=${encodeURIComponent(a.salvo!.storage_path)}`,
          );
          return [a.id, r.data.url] as const;
        } catch {
          return [a.id, null] as const;
        }
      }),
    ).then((resultados) => {
      if (cancelado) return;
      const urlPorId = new Map(
        resultados.filter((r): r is readonly [string, string] => r[1] !== null),
      );
      if (urlPorId.size === 0) return;
      setAnexos((atuais) =>
        atuais.map((a) => (urlPorId.has(a.id) ? { ...a, url: urlPorId.get(a.id)! } : a)),
      );
    });
    return () => {
      cancelado = true;
    };
  }, [anexos]);

  /**
   * `silencioso` é a recarga que o banco pede (evento de realtime ou o refetch
   * de segurança): ela não acende o spinner nem trava o botão Atualizar —
   * quem está lendo a lista não pediu nada, e a tela só troca os dados.
   */
  async function carregar(opcoes?: { silencioso?: boolean }) {
    const silencioso = opcoes?.silencioso === true;
    if (!silencioso) setCarregando(true);
    setErro(null);
    try {
      const [sess, groups, schedules, runs] = await Promise.all([
        apiClient.get<{ data: ChannelSession[] }>("/api/v1/channel-sessions"),
        apiClient.get<{ data: { groups: GrupoSalvo[] } }>(
          "/api/v1/agendamentos/grupos?active=true",
        ),
        apiClient.get<{ data: { schedules: Agendamento[] } }>("/api/v1/agendamentos?limit=100"),
        apiClient.get<{ data: { runs: Execucao[] } }>("/api/v1/agendamentos/execucoes?limit=100"),
      ]);
      setConexoes(sess.data);
      setGrupos(groups.data.groups);
      setAgendamentos(schedules.data.schedules);
      setExecucoes(runs.data.runs);
      // Nenhum grupo vem marcado de fábrica: o destino de um disparo é escolha
      // explícita — a versão anterior pré-marcava o primeiro da lista, e um
      // clique apressado em "Criar" mandava para o grupo errado.
    } catch {
      setErro("Não foi possível carregar os agendamentos.");
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }

  /**
   * O banco avisa; a tela rebusca. Uma execução gera vários eventos em
   * sequência (INSERT pending → UPDATE sending → UPDATE sent, e o UPDATE do
   * agendamento pai), então os avisos são juntados numa recarga só, 400 ms
   * depois do último — o suficiente para a lista mostrar "Enviado" de uma vez,
   * sem quatro idas à API.
   *
   * Na aba "Agendar" os canais ficam fechados de propósito: recarregar
   * `agendamentos` ali re-hidrata o formulário de edição (efeito de
   * `?editar=`) por cima do que a pessoa está digitando.
   */
  const recargaPendente = useRef<number | null>(null);
  const escutaOBanco = aba !== "agendar" && !!orgId;
  function agendarRecarga() {
    if (recargaPendente.current !== null) window.clearTimeout(recargaPendente.current);
    recargaPendente.current = window.setTimeout(() => {
      recargaPendente.current = null;
      void carregar({ silencioso: true });
    }, 400);
  }
  useEffect(
    () => () => {
      if (recargaPendente.current !== null) window.clearTimeout(recargaPendente.current);
    },
    [],
  );
  const canalDasExecucoes = useRealtimeChannel({
    name: orgId ? `disparo-execucoes-${orgId}` : "disparo-execucoes-desligado",
    postgresChanges: orgId
      ? {
          event: "*",
          table: "scheduled_group_message_runs",
          filter: `organization_id=eq.${orgId}`,
        }
      : undefined,
    onChange: agendarRecarga,
    enabled: escutaOBanco,
  });
  useRealtimeChannel({
    name: orgId ? `disparo-agendamentos-${orgId}` : "disparo-agendamentos-desligado",
    postgresChanges: orgId
      ? {
          event: "*",
          table: "scheduled_group_messages",
          filter: `organization_id=eq.${orgId}`,
        }
      : undefined,
    onChange: agendarRecarga,
    enabled: escutaOBanco,
  });

  useEffect(() => {
    // A primeira carga é a semente da tela; recarregar fica no botão Atualizar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, []);

  useEffect(() => {
    if (!editandoIdNaUrl || agendamentos.length === 0) return;
    const agendamento = agendamentos.find(({ id }) => id === editandoIdNaUrl);
    // A URL de edição é uma fonte externa; a hidratação intencionalmente atualiza o formulário.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (agendamento) preencherFormulario(agendamento);
  }, [agendamentos, editandoIdNaUrl]);

  useEffect(() => {
    // Refetch de segurança: o Realtime não guarda o que aconteceu enquanto o
    // canal esteve fora, então a lista ainda se confere sozinha de tempos em
    // tempos — sem spinner, porque ninguém pediu.
    if (aba === "agendar") return;
    const intervalo = window.setInterval(() => void carregar({ silencioso: true }), 60_000);
    return () => window.clearInterval(intervalo);
  }, [aba]);

  function selecionarConexao(id: string) {
    setGrupoConexaoId(id);
    setGruposEncontrados([]);
    setFiltroGrupos("");
  }

  async function buscarGrupos() {
    if (!grupoConexaoId) {
      toast.error("Selecione uma conexão primeiro.");
      return;
    }
    setBuscandoGrupos(true);
    try {
      const response = await apiClient.post<{ data: { groups: GrupoEncontrado[] } }>(
        "/api/v1/agendamentos/grupos/sync",
        { channel_session_id: grupoConexaoId },
      );
      setGruposEncontrados(response.data.groups);
      setFiltroGrupos("");
      toast.success(
        response.data.groups.length
          ? `${response.data.groups.length} grupo(s) encontrado(s).`
          : "Nenhum grupo encontrado nesta conexão.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível buscar os grupos desta conexão.",
      );
    } finally {
      setBuscandoGrupos(false);
    }
  }

  async function salvarGrupoEncontrado(grupo: GrupoEncontrado) {
    if (!grupoConexaoId) return;
    setSalvando(true);
    try {
      await apiClient.post("/api/v1/agendamentos/grupos", {
        channel_session_id: grupoConexaoId,
        external_group_id: grupo.externalId,
        name: grupo.name,
        is_active: true,
        metadata: {
          group_kind: grupo.groupKind,
          participant_count: grupo.participantCount,
        },
      });
      setGruposEncontrados((prev) => prev.filter((item) => item.externalId !== grupo.externalId));
      await carregar();
      toast.success("Grupo salvo.");
    } catch {
      toast.error("Não foi possível salvar o grupo.");
    } finally {
      setSalvando(false);
    }
  }

  async function criarAgendamento() {
    if (gruposEscolhidos.length === 0) {
      toast.error("Selecione pelo menos um grupo.");
      return;
    }
    if (!mensagem.trim()) {
      toast.error("Escreva a mensagem.");
      return;
    }
    setSalvando(true);
    try {
      // Sobe os arquivos novos um a um, na ordem da lista; os já gravados
      // seguem como estão. A ordem final é a ordem da tela — e da prévia.
      const media_items: MidiaAgendada[] = [];
      for (const anexo of anexos) {
        if (anexo.salvo) {
          media_items.push(anexo.salvo);
          continue;
        }
        if (!anexo.file) continue;
        const form = new FormData();
        form.append("file", anexo.file);
        const response = await fetch("/api/v1/agendamentos/media", {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        const json = (await response.json()) as {
          data?: { media?: MidiaAgendada };
          error?: { message?: string };
        };
        if (!response.ok || !json.data?.media) {
          throw new Error(
            `${anexo.nome}: ${json.error?.message || "não foi possível enviar o arquivo."}`,
          );
        }
        media_items.push(json.data.media);
      }
      const recurrence_config =
        recorrencia === "custom"
          ? { interval_minutes: Math.max(1, Number(intervaloCustom) || 60) }
          : {};
      const base = {
        title: titulo.trim() || null,
        body: mensagem.trim(),
        status,
        starts_at: isoDeInput(quando),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
        recurrence_kind: recorrencia,
        recurrence_config,
        repeat_until: repeatUntil ? isoDeInput(repeatUntil) : null,
        max_runs: maxRuns ? Math.max(1, Number(maxRuns)) : null,
        media_items,
      };
      if (editandoId) {
        await apiClient.patch(`/api/v1/agendamentos/${editandoId}`, {
          ...base,
          group_id: gruposEscolhidos[0]!.id,
        });
        toast.success("Agendamento atualizado.");
      } else {
        await apiClient.post("/api/v1/agendamentos", {
          ...base,
          group_ids: gruposEscolhidos.map((g) => g.id),
        });
        toast.success(
          status === "draft"
            ? "Rascunho salvo."
            : gruposEscolhidos.length > 1
              ? `Disparo agendado para ${gruposEscolhidos.length} grupos.`
              : "Agendamento criado.",
        );
      }
      limparFormulario();
      await carregar();
      router.push("/app/disparo/lista");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível criar o agendamento.",
      );
    } finally {
      setSalvando(false);
    }
  }

  function editarAgendamento(agendamento: Agendamento) {
    preencherFormulario(agendamento);
    router.push(`/app/disparo/agendar?editar=${encodeURIComponent(agendamento.id)}`);
  }

  function cancelarEdicao() {
    limparFormulario();
    router.push("/app/disparo/agendar");
  }

  async function acaoAgendamento(id: string, acao: "pause" | "resume" | "cancel") {
    setSalvando(true);
    try {
      const body = acao === "cancel" ? { reason: "Cancelado pela tela de agendamentos." } : {};
      await apiClient.post(`/api/v1/agendamentos/${id}/${acao}`, body);
      toast.success(
        acao === "pause"
          ? "Agendamento pausado."
          : acao === "resume"
            ? "Agendamento retomado."
            : "Agendamento cancelado.",
      );
      await carregar();
    } catch {
      toast.error("Não foi possível atualizar o agendamento.");
    } finally {
      setSalvando(false);
    }
  }

  const anexosDaPrevia = useMemo<AnexoDaPrevia[]>(
    () =>
      anexos.map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.url,
        nome: a.nome,
        mime: a.mime,
        sizeBytes: a.sizeBytes,
      })),
    [anexos],
  );
  const nomeDaConexaoPorId = useCallback(
    (id: string) => {
      const c = conexoes.find((x) => x.id === id);
      return c ? nomeDaConexao(c) : `Conexão ${id.slice(0, 8)}`;
    },
    [conexoes],
  );

  const agendados = agendamentos.filter((a) => a.status === "scheduled").length;
  const entregues = execucoes.filter((e) => e.status === "sent").length;
  const falhas = execucoes.filter((e) => e.status === "failed").length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-6 overflow-y-auto">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Disparo")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Envios programados para grupos salvos, com recorrência e histórico de execução.")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-xs"
          onClick={() => void carregar()}
          disabled={carregando}
        >
          <ArrowsClockwise size={14} className={cn(carregando && "animate-spin")} aria-hidden />
          {t("Atualizar")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Resumo
          titulo={t("Agendados")}
          valor={agendados}
          detalhe={t("Próximos disparos")}
          icone={<CalendarDots size={18} />}
        />
        <Resumo
          titulo={t("Enviados")}
          valor={entregues}
          detalhe={t("Execuções enviadas")}
          icone={<CheckCircle size={18} />}
        />
        <Resumo
          titulo={t("Falhas")}
          valor={falhas}
          detalhe={t("Precisam de revisão")}
          icone={<Warning size={18} />}
        />
      </div>

      {erro ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {erro}
        </div>
      ) : null}

      <div className="space-y-4">
        {aba === "agendar" && (
          <Card>
            <CardHeader className="border-b pb-5">
              <CardTitle>
                {editandoId ? t("Editar disparo") : t("Novo disparo programado")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Defina o conteúdo, o destino e quando o envio deve acontecer. A execução aparecerá na lista assim que o horário chegar.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 pt-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <Campo label={editandoId ? t("Grupo") : t("Grupos de destino")}>
                  <SeletorDeGrupos
                    grupos={grupos.map((g) => ({
                      id: g.id,
                      name: g.name,
                      channel_session_id: g.channel_session_id,
                      is_active: g.is_active,
                      participantes:
                        typeof g.metadata?.participant_count === "number"
                          ? (g.metadata.participant_count as number)
                          : null,
                    }))}
                    nomeDaConexao={nomeDaConexaoPorId}
                    selecionados={gruposSelecionados}
                    onChange={setGruposSelecionados}
                    disabled={!podeEditar || salvando}
                    unico={!!editandoId}
                  />
                  {editandoId ? (
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "Um agendamento tem um grupo só. Para vários grupos, crie um disparo novo.",
                      )}
                    </p>
                  ) : null}
                </Campo>
                <Campo label={t("Título interno")}>
                  <Input
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    placeholder={t("Promoção de sexta")}
                    disabled={!podeEditar}
                  />
                </Campo>
                <Campo label={t("Mensagem")}>
                  <Textarea
                    value={mensagem}
                    onChange={(e) => setMensagem(e.target.value)}
                    placeholder={t("Escreva a mensagem que será enviada ao grupo")}
                    className="min-h-36"
                    disabled={!podeEditar}
                  />
                </Campo>
                <Campo label={t("Arquivos")}>
                  <input
                    ref={inputMidiaRef}
                    type="file"
                    multiple
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                    className="sr-only"
                    onChange={(event) => adicionarArquivos(event.target.files)}
                    disabled={!podeEditar || salvando}
                  />
                  {anexos.length > 0 ? (
                    <ul
                      className="divide-y overflow-hidden rounded-lg border bg-muted/30"
                      data-lista-de-anexos
                    >
                      {anexos.map((anexo, i) => (
                        <li key={anexo.id} className="flex items-center gap-3 p-2.5">
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-surface text-primary">
                            {anexo.kind === "image" && anexo.url ? (
                              // eslint-disable-next-line @next/next/no-img-element -- prévia local/assinada
                              <img src={anexo.url} alt="" className="h-full w-full object-cover" />
                            ) : anexo.kind === "image" ? (
                              <ImageSquare size={22} aria-hidden />
                            ) : anexo.kind === "video" ? (
                              <VideoCamera size={22} aria-hidden />
                            ) : anexo.kind === "audio" ? (
                              <MusicNote size={22} aria-hidden />
                            ) : (
                              <FileText size={22} aria-hidden />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{anexo.nome}</p>
                            <p className="text-xs text-muted-foreground">
                              {anexo.kind === "image"
                                ? t("Foto")
                                : anexo.kind === "video"
                                  ? t("Vídeo")
                                  : anexo.kind === "audio"
                                    ? t("Áudio")
                                    : t("Documento")}
                              {" · "}
                              {formatBytes(anexo.sizeBytes)}
                              {anexo.salvo ? ` · ${t("já enviado")}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={t("Mover para cima")}
                              onClick={() => moverAnexo(anexo.id, -1)}
                              disabled={!podeEditar || salvando || i === 0}
                            >
                              <CaretUp size={14} aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={t("Mover para baixo")}
                              onClick={() => moverAnexo(anexo.id, 1)}
                              disabled={!podeEditar || salvando || i === anexos.length - 1}
                            >
                              <CaretDown size={14} aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              aria-label={t("Remover")}
                              onClick={() => removerAnexo(anexo.id)}
                              disabled={!podeEditar || salvando}
                            >
                              <Trash size={15} aria-hidden />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full gap-2 border-dashed",
                      anexos.length === 0 ? "h-24 flex-col" : "h-10",
                    )}
                    onClick={() => inputMidiaRef.current?.click()}
                    disabled={
                      !podeEditar || salvando || anexos.length >= MAXIMO_DE_ARQUIVOS_POR_DISPARO
                    }
                  >
                    <Paperclip
                      size={anexos.length === 0 ? 22 : 16}
                      className="text-primary"
                      aria-hidden
                    />
                    {anexos.length === 0 ? t("Adicionar arquivos") : t("Adicionar mais arquivos")}
                    <span className="text-xs font-normal text-muted-foreground">
                      {anexos.length === 0
                        ? t("Fotos, vídeos, áudios e documentos · até 50 MB cada")
                        : `${anexos.length}/${MAXIMO_DE_ARQUIVOS_POR_DISPARO}`}
                    </span>
                  </Button>
                  {anexos.length > 1 ? (
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "Cada arquivo sai como uma mensagem, nesta ordem. O texto vai junto do último.",
                      )}
                    </p>
                  ) : null}
                </Campo>
              </div>

              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo label={t("Quando")}>
                    <Input
                      type="datetime-local"
                      value={quando}
                      onChange={(e) => setQuando(e.target.value)}
                      disabled={!podeEditar}
                    />
                  </Campo>
                  <Campo label={t("Status")}>
                    <Select
                      value={status}
                      onValueChange={(v) => setStatus(v as "scheduled" | "draft")}
                      disabled={!podeEditar}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scheduled">{t("Agendado")}</SelectItem>
                        <SelectItem value="draft">{t("Rascunho")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Campo>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo label={t("Recorrência")}>
                    <Select
                      value={recorrencia}
                      onValueChange={(v) => setRecorrencia(v as Recorrencia)}
                      disabled={!podeEditar}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("Não repetir")}</SelectItem>
                        <SelectItem value="daily">{t("Diária")}</SelectItem>
                        <SelectItem value="weekly">{t("Semanal")}</SelectItem>
                        <SelectItem value="monthly">{t("Mensal")}</SelectItem>
                        <SelectItem value="custom">{t("Personalizada")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label={t("Intervalo personalizado")}>
                    <Input
                      type="number"
                      min={1}
                      value={intervaloCustom}
                      onChange={(e) => setIntervaloCustom(e.target.value)}
                      disabled={!podeEditar || recorrencia !== "custom"}
                    />
                  </Campo>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo label={t("Máximo de envios")}>
                    <Input
                      type="number"
                      min={1}
                      value={maxRuns}
                      onChange={(e) => setMaxRuns(e.target.value)}
                      disabled={!podeEditar}
                    />
                  </Campo>
                  <Campo label={t("Repetir até")}>
                    <Input
                      type="datetime-local"
                      value={repeatUntil}
                      onChange={(e) => setRepeatUntil(e.target.value)}
                      disabled={!podeEditar}
                    />
                  </Campo>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  {gruposEscolhidos.length === 0 ? (
                    grupos.length === 0 ? (
                      t("Salve um grupo antes de criar o primeiro agendamento.")
                    ) : (
                      t("Marque ao menos um grupo de destino.")
                    )
                  ) : gruposEscolhidos.length === 1 && grupoSelecionado ? (
                    <span>
                      {t("Grupo")}:{" "}
                      <strong className="text-foreground">{grupoSelecionado.name}</strong>
                      {conexaoDoGrupo ? ` · ${nomeDaConexao(conexaoDoGrupo)}` : ""}
                    </span>
                  ) : (
                    <span>
                      {t("Disparo para")}{" "}
                      <strong className="text-foreground">{gruposEscolhidos.length}</strong>{" "}
                      {t("grupos")}: {gruposEscolhidos.map((g) => g.name).join(", ")}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {editandoId ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={cancelarEdicao}
                      disabled={salvando}
                    >
                      {t("Cancelar edição")}
                    </Button>
                  ) : null}
                  <Button
                    className="flex-1 gap-1.5"
                    onClick={criarAgendamento}
                    disabled={!podeEditar || salvando || carregando}
                  >
                    <Plus size={16} aria-hidden />
                    {editandoId ? t("Salvar alterações") : t("Criar agendamento")}
                  </Button>
                </div>
              </div>

              <div className="lg:col-span-2 xl:col-span-1">
                <div className="xl:sticky xl:top-4">
                  <p className="mb-3 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("Como vai chegar no WhatsApp")}
                  </p>
                  <PreviaDoCelular
                    grupos={gruposEscolhidos.map((g) => g.name)}
                    mensagem={mensagem}
                    anexos={anexosDaPrevia}
                    horario={horaDoInput(quando)}
                    dataLegenda={legendaDaData(quando, tagDoIdioma, t("Hoje"))}
                  />
                  <p className="mt-3 text-center text-[11px] text-muted-foreground">
                    {t("Use *negrito*, _itálico_ e ~riscado~ como no WhatsApp.")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {aba === "agendamentos" && (
          <div
            className="overflow-hidden rounded-lg border bg-surface shadow-xs"
            data-realtime-status={canalDasExecucoes.status}
          >
            {agendamentos.length === 0 ? (
              <EstadoVazio texto={t("Nenhum agendamento criado ainda.")} />
            ) : (
              <div className="divide-y">
                {agendamentos.map((a) => (
                  <div
                    key={a.id}
                    className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-medium">
                          {a.title || t("Agendamento sem título")}
                        </h2>
                        <Badge variant={badgeStatus(a.status)}>{t(STATUS_LABEL[a.status])}</Badge>
                        {a.latest_execution ? (
                          <Badge variant={badgeExecucao(a.latest_execution.status)}>
                            {t("Última execução:")} {t(EXECUCAO_LABEL[a.latest_execution.status])}
                          </Badge>
                        ) : null}
                        {a.recurrence_kind !== "none" ? (
                          <Badge variant="outline">{t("Recorrente")}</Badge>
                        ) : null}
                        {(a.media_items?.length ?? (a.media ? 1 : 0)) > 0 ? (
                          <Badge variant="outline">
                            {a.media_items?.length ?? 1} {t("arquivo(s)")}
                          </Badge>
                        ) : null}
                        {a.batch ? (
                          <Badge variant="outline">
                            {t("Lote")} {a.batch.index + 1}/{a.batch.size}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {a.scheduled_whatsapp_groups?.name ?? t("Grupo")} {t("· Próximo:")}{" "}
                        {dataCurta(a.next_run_at, tagDoIdioma, t("Sem próxima execução"))}{" "}
                        {t("· Último:")}{" "}
                        {dataCurta(a.last_run_at, tagDoIdioma, t("Ainda não executado"))}
                      </p>
                      {a.latest_execution?.error_message ? (
                        <p className="mt-1 text-xs text-destructive">
                          {a.latest_execution.error_message}
                        </p>
                      ) : null}
                    </div>
                    {podeEditar ? (
                      <div className="flex flex-wrap gap-2">
                        {a.status !== "cancelled" && a.status !== "completed" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => editarAgendamento(a)}
                            disabled={salvando}
                          >
                            <PencilSimple size={14} aria-hidden /> {t("Editar")}
                          </Button>
                        ) : null}
                        {a.status === "scheduled" || a.status === "draft" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => acaoAgendamento(a.id, "pause")}
                            disabled={salvando}
                          >
                            <Pause size={14} aria-hidden /> {t("Pausar")}
                          </Button>
                        ) : null}
                        {a.status === "paused" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => acaoAgendamento(a.id, "resume")}
                            disabled={salvando}
                          >
                            <Play size={14} aria-hidden /> {t("Retomar")}
                          </Button>
                        ) : null}
                        {a.status !== "cancelled" && a.status !== "completed" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs text-destructive"
                            onClick={() => acaoAgendamento(a.id, "cancel")}
                            disabled={salvando}
                          >
                            <X size={14} aria-hidden /> {t("Cancelar")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {aba === "grupos" && (
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <div className="space-y-3 rounded-lg border bg-surface p-4 shadow-xs">
              <h2 className="text-sm font-semibold">{t("Salvar grupo")}</h2>
              <Campo label={t("Conexão")}>
                <Select
                  value={grupoConexaoId}
                  onValueChange={selecionarConexao}
                  disabled={!podeEditar || conexoesComGrupos.length === 0 || buscandoGrupos}
                >
                  <SelectTrigger aria-label={t("Conexão do WhatsApp")}>
                    <SelectValue placeholder={t("Selecione a conta conectada")} />
                  </SelectTrigger>
                  <SelectContent>
                    {conexoesComGrupos.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {nomeDaConexao(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Button
                className="w-full gap-1.5"
                onClick={() => void buscarGrupos()}
                disabled={!podeEditar || !grupoConexaoId || buscandoGrupos}
              >
                <ArrowsClockwise
                  size={16}
                  className={cn(buscandoGrupos && "animate-spin")}
                  aria-hidden
                />
                {buscandoGrupos ? t("Listando grupos…") : t("Listar grupos da conexão")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Selecione a conta do WhatsApp e clique no botão. Depois, salve os grupos que aparecerem.",
                )}
              </p>
              {conexoesComGrupos.length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  {t(
                    "Nenhuma conexão com suporte a grupos foi encontrada. Conecte ou ative uma conta compatível em Conexões e volte para listar os grupos.",
                  )}
                </p>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border bg-surface shadow-xs">
              {gruposEncontrados.length > 0 ? (
                <div>
                  <div className="flex flex-col gap-2 border-b bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <Input
                      value={filtroGrupos}
                      onChange={(event) => setFiltroGrupos(event.target.value)}
                      placeholder={t("Pesquisar grupo pelo nome…")}
                      aria-label={t("Pesquisar grupo pelo nome")}
                    />
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {gruposEncontradosVisiveis.length} de {gruposEncontrados.length} grupo(s)
                    </p>
                  </div>
                  {gruposEncontradosVisiveis.length === 0 ? (
                    <EstadoVazio texto={t("Nenhum grupo corresponde à pesquisa.")} />
                  ) : (
                    <div className="divide-y">
                      {gruposEncontradosVisiveis.map((g) => (
                        <div
                          key={g.externalId}
                          className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-medium">{g.name}</h3>
                              <Badge
                                variant={g.groupKind === "announcement" ? "secondary" : "outline"}
                              >
                                {g.groupKind === "announcement"
                                  ? t("Grupo de avisos")
                                  : g.groupKind === "community"
                                    ? t("Comunidade")
                                    : t("Grupo normal")}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {g.participantCount === null
                                ? t("Participantes não informados")
                                : `${g.participantCount} ${t("participante(s)")}`}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {g.externalId}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => void salvarGrupoEncontrado(g)}
                            disabled={!podeEditar || salvando}
                          >
                            {t("Salvar")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : grupos.length === 0 ? (
                <EstadoVazio texto={t("Nenhum grupo salvo ainda.")} />
              ) : (
                <div className="divide-y">
                  {grupos.map((g) => (
                    <div
                      key={g.id}
                      className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-medium">{g.name}</h3>
                          <Badge variant={g.is_active ? "default" : "secondary"}>
                            {g.is_active ? t("Ativo") : t("Inativo")}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {g.external_group_id}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {dataCurta(g.last_seen_at, tagDoIdioma, t("Sem atividade registrada"))}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {aba === "historico" && (
          <div
            className="overflow-hidden rounded-lg border bg-surface shadow-xs"
            data-realtime-status={canalDasExecucoes.status}
          >
            {execucoes.length === 0 ? (
              <EstadoVazio texto={t("Nenhuma execução registrada ainda.")} />
            ) : (
              <div className="divide-y">
                {execucoes.map((e) => (
                  <div
                    key={e.id}
                    className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-medium">
                          {e.scheduled_group_messages?.title || t("Envio agendado")}
                        </h3>
                        <Badge variant={badgeExecucao(e.status)}>
                          {t(EXECUCAO_LABEL[e.status])}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {e.scheduled_whatsapp_groups?.name ?? t("Grupo")} {t("· Programado para")}{" "}
                        {dataCurta(e.scheduled_for, tagDoIdioma, t("Sem data"))}
                      </p>
                      {e.error_message ? (
                        <p className="mt-1 text-xs text-destructive">{e.error_message}</p>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {e.sent_at
                        ? `${t("Enviado")} ${dataCurta(e.sent_at, tagDoIdioma, t("Sem data"))}`
                        : (e.error_code ?? "")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Resumo({
  titulo,
  valor,
  detalhe,
  icone,
}: {
  titulo: string;
  valor: number;
  detalhe: string;
  icone: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{titulo}</p>
            <p className="mt-1 text-2xl font-semibold">{valor}</p>
          </div>
          <div className="rounded-md border bg-muted p-2 text-muted-foreground">{icone}</div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{detalhe}</p>
      </CardContent>
    </Card>
  );
}

function EstadoVazio({ texto }: { texto: string }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{texto}</div>;
}
