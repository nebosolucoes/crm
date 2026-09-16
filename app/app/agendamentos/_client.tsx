"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import {
  ArrowsClockwise,
  CalendarDots,
  CheckCircle,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Warning,
  X,
} from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

type StatusAgendamento = "draft" | "scheduled" | "paused" | "cancelled" | "completed";
type Recorrencia = "none" | "daily" | "weekly" | "monthly" | "custom";
type StatusExecucao = "pending" | "sending" | "sent" | "failed" | "skipped";

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
  waha_session_name?: string | null;
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
  sent: "Entregue",
  failed: "Falhou",
  skipped: "Ignorado",
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

function dataCurta(value: string | null): string {
  if (!value) return "Sem próxima execução";
  return new Intl.DateTimeFormat("pt-BR", {
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
    c.waha_session_name?.trim() ||
    c.provider?.trim() ||
    `Conexão ${c.id.slice(0, 8)}`
  );
}

function conexaoTemGrupos(c: ChannelSession): boolean {
  return c.provider === "waha";
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

  const [grupoId, setGrupoId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [quando, setQuando] = useState(agoraLocal);
  const [status, setStatus] = useState<"scheduled" | "draft">("scheduled");
  const [recorrencia, setRecorrencia] = useState<Recorrencia>("none");
  const [intervaloCustom, setIntervaloCustom] = useState("60");
  const [maxRuns, setMaxRuns] = useState("");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const editandoIdNaUrl = searchParams.get("editar");

  const conexoesComGrupos = useMemo(
    () => conexoes.filter(conexaoTemGrupos),
    [conexoes],
  );

  const grupoSelecionado = useMemo(
    () => grupos.find((g) => g.id === grupoId) ?? null,
    [grupoId, grupos],
  );

  const gruposEncontradosVisiveis = useMemo(() => {
    const filtro = filtroGrupos.trim().toLocaleLowerCase();
    if (!filtro) return gruposEncontrados;
    return gruposEncontrados.filter((grupo) => grupo.name.toLocaleLowerCase().includes(filtro));
  }, [filtroGrupos, gruposEncontrados]);

  const conexaoDoGrupo = useMemo(
    () => conexoes.find((c) => c.id === grupoSelecionado?.channel_session_id) ?? null,
    [conexoes, grupoSelecionado],
  );

  function preencherFormulario(agendamento: Agendamento) {
    setEditandoId(agendamento.id);
    setGrupoId(agendamento.group_id);
    setTitulo(agendamento.title ?? "");
    setMensagem(agendamento.body);
    setQuando(inputDeIso(agendamento.starts_at));
    setStatus(agendamento.status === "draft" ? "draft" : "scheduled");
    setRecorrencia(agendamento.recurrence_kind);
    setIntervaloCustom(String(agendamento.recurrence_config.interval_minutes ?? 60));
    setMaxRuns(agendamento.max_runs === null ? "" : String(agendamento.max_runs));
    setRepeatUntil(agendamento.repeat_until ? inputDeIso(agendamento.repeat_until) : "");
  }

  function limparFormulario() {
    setEditandoId(null);
    setTitulo("");
    setMensagem("");
    setQuando(agoraLocal());
    setStatus("scheduled");
    setRecorrencia("none");
    setIntervaloCustom("60");
    setMaxRuns("");
    setRepeatUntil("");
  }

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const [sess, groups, schedules, runs] = await Promise.all([
        apiClient.get<{ data: ChannelSession[] }>("/api/v1/channel-sessions"),
        apiClient.get<{ data: { groups: GrupoSalvo[] } }>("/api/v1/agendamentos/grupos?active=true"),
        apiClient.get<{ data: { schedules: Agendamento[] } }>("/api/v1/agendamentos?limit=100"),
        apiClient.get<{ data: { runs: Execucao[] } }>("/api/v1/agendamentos/execucoes?limit=100"),
      ]);
      setConexoes(sess.data);
      setGrupos(groups.data.groups);
      setAgendamentos(schedules.data.schedules);
      setExecucoes(runs.data.runs);
      if (!grupoId && groups.data.groups[0]) setGrupoId(groups.data.groups[0].id);
    } catch {
      setErro("Não foi possível carregar os agendamentos.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    // A primeira carga é a semente da tela; recarregar fica no botão Atualizar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editandoIdNaUrl || agendamentos.length === 0) return;
    const agendamento = agendamentos.find(({ id }) => id === editandoIdNaUrl);
    // A URL de edição é uma fonte externa; a hidratação intencionalmente atualiza o formulário.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (agendamento) preencherFormulario(agendamento);
  }, [agendamentos, editandoIdNaUrl]);

  useEffect(() => {
    if (aba === "agendar") return;
    const intervalo = window.setInterval(() => void carregar(), 15_000);
    return () => window.clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!grupoSelecionado) {
      toast.error("Selecione um grupo.");
      return;
    }
    if (!mensagem.trim()) {
      toast.error("Escreva a mensagem.");
      return;
    }
    setSalvando(true);
    try {
      const recurrence_config =
        recorrencia === "custom"
          ? { interval_minutes: Math.max(1, Number(intervaloCustom) || 60) }
          : {};
      const payload = {
        channel_session_id: grupoSelecionado.channel_session_id,
        group_id: grupoSelecionado.id,
        title: titulo.trim() || null,
        body: mensagem.trim(),
        status,
        starts_at: isoDeInput(quando),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
        recurrence_kind: recorrencia,
        recurrence_config,
        repeat_until: repeatUntil ? isoDeInput(repeatUntil) : null,
        max_runs: maxRuns ? Math.max(1, Number(maxRuns)) : null,
      };
      if (editandoId) {
        await apiClient.patch(`/api/v1/agendamentos/${editandoId}`, payload);
        toast.success("Agendamento atualizado.");
      } else {
        await apiClient.post("/api/v1/agendamentos", payload);
        toast.success(status === "draft" ? "Rascunho salvo." : "Agendamento criado.");
      }
      limparFormulario();
      await carregar();
      router.push("/app/disparo/lista");
    } catch {
      toast.error("Não foi possível criar o agendamento.");
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
      toast.success(acao === "pause" ? "Agendamento pausado." : acao === "resume" ? "Agendamento retomado." : "Agendamento cancelado.");
      await carregar();
    } catch {
      toast.error("Não foi possível atualizar o agendamento.");
    } finally {
      setSalvando(false);
    }
  }

  const agendados = agendamentos.filter((a) => a.status === "scheduled").length;
  const entregues = execucoes.filter((e) => e.status === "sent").length;
  const falhas = execucoes.filter((e) => e.status === "failed").length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Disparo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Envios programados para grupos salvos, com recorrência e histórico de execução.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={carregar} disabled={carregando}>
          <ArrowsClockwise size={14} className={cn(carregando && "animate-spin")} aria-hidden />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Resumo titulo="Agendados" valor={agendados} detalhe="Próximos disparos" icone={<CalendarDots size={18} />} />
        <Resumo titulo="Entregues" valor={entregues} detalhe="Execuções enviadas" icone={<CheckCircle size={18} />} />
        <Resumo titulo="Falhas" valor={falhas} detalhe="Precisam de revisão" icone={<Warning size={18} />} />
      </div>

      {erro ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {erro}
        </div>
      ) : null}

      <div className="space-y-4">
        {aba === "agendar" && (
          <div className="grid gap-4 rounded-lg border bg-card p-4 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-4">
              <Campo label="Grupo">
                <Select value={grupoId} onValueChange={setGrupoId} disabled={!podeEditar || grupos.length === 0}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um grupo salvo" />
                  </SelectTrigger>
                  <SelectContent>
                    {grupos.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo label="Título interno">
                <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Promoção de sexta" disabled={!podeEditar} />
              </Campo>
              <Campo label="Mensagem">
                <Textarea
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  placeholder="Escreva a mensagem que será enviada ao grupo"
                  className="min-h-36"
                  disabled={!podeEditar}
                />
              </Campo>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Quando">
                  <Input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Status">
                  <Select value={status} onValueChange={(v) => setStatus(v as "scheduled" | "draft")} disabled={!podeEditar}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">Agendado</SelectItem>
                      <SelectItem value="draft">Rascunho</SelectItem>
                    </SelectContent>
                  </Select>
                </Campo>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Recorrência">
                  <Select value={recorrencia} onValueChange={(v) => setRecorrencia(v as Recorrencia)} disabled={!podeEditar}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não repetir</SelectItem>
                      <SelectItem value="daily">Diária</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                      <SelectItem value="custom">Personalizada</SelectItem>
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo label="Intervalo custom">
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
                <Campo label="Máximo de envios">
                  <Input type="number" min={1} value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Repetir até">
                  <Input type="datetime-local" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} disabled={!podeEditar} />
                </Campo>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                {grupoSelecionado ? (
                  <span>
                    Grupo: <strong className="text-foreground">{grupoSelecionado.name}</strong>
                    {conexaoDoGrupo ? ` · ${nomeDaConexao(conexaoDoGrupo)}` : ""}
                  </span>
                ) : (
                  "Salve um grupo antes de criar o primeiro agendamento."
                )}
              </div>
              <div className="flex gap-2">
                {editandoId ? (
                  <Button type="button" variant="outline" className="flex-1" onClick={cancelarEdicao} disabled={salvando}>
                    Cancelar edição
                  </Button>
                ) : null}
                <Button className="flex-1 gap-1.5" onClick={criarAgendamento} disabled={!podeEditar || salvando || carregando}>
                <Plus size={16} aria-hidden />
                {editandoId ? "Salvar alterações" : "Criar agendamento"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {aba === "agendamentos" && (
          <div className="overflow-hidden rounded-lg border bg-card">
            {agendamentos.length === 0 ? (
              <EstadoVazio texto="Nenhum agendamento criado ainda." />
            ) : (
              <div className="divide-y">
                {agendamentos.map((a) => (
                  <div key={a.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-medium">{a.title || "Agendamento sem título"}</h2>
                        <Badge variant={badgeStatus(a.status)}>{STATUS_LABEL[a.status]}</Badge>
                        {a.recurrence_kind !== "none" ? <Badge variant="outline">Recorrente</Badge> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {a.scheduled_whatsapp_groups?.name ?? "Grupo"} · Próximo: {dataCurta(a.next_run_at)} · Último: {dataCurta(a.last_run_at)}
                      </p>
                    </div>
                    {podeEditar ? (
                      <div className="flex flex-wrap gap-2">
                        {a.status !== "cancelled" && a.status !== "completed" ? (
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => editarAgendamento(a)} disabled={salvando}>
                            <PencilSimple size={14} aria-hidden /> Editar
                          </Button>
                        ) : null}
                        {a.status === "scheduled" || a.status === "draft" ? (
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => acaoAgendamento(a.id, "pause")} disabled={salvando}>
                            <Pause size={14} aria-hidden /> Pausar
                          </Button>
                        ) : null}
                        {a.status === "paused" ? (
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => acaoAgendamento(a.id, "resume")} disabled={salvando}>
                            <Play size={14} aria-hidden /> Retomar
                          </Button>
                        ) : null}
                        {a.status !== "cancelled" && a.status !== "completed" ? (
                          <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive" onClick={() => acaoAgendamento(a.id, "cancel")} disabled={salvando}>
                            <X size={14} aria-hidden /> Cancelar
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
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">Salvar grupo</h2>
              <Campo label="Conexão">
                <Select value={grupoConexaoId} onValueChange={selecionarConexao} disabled={!podeEditar || conexoesComGrupos.length === 0 || buscandoGrupos}>
                  <SelectTrigger aria-label="Conexão do WhatsApp"><SelectValue placeholder="Selecione a conta conectada" /></SelectTrigger>
                  <SelectContent>
                    {conexoesComGrupos.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{nomeDaConexao(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Button className="w-full gap-1.5" onClick={() => void buscarGrupos()} disabled={!podeEditar || !grupoConexaoId || buscandoGrupos}>
                <ArrowsClockwise size={16} className={cn(buscandoGrupos && "animate-spin")} aria-hidden />
                {buscandoGrupos ? "Listando grupos…" : "Listar grupos da conexão"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Selecione a conta do WhatsApp e clique no botão. Depois, salve os grupos que aparecerem.
              </p>
              {conexoesComGrupos.length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Nenhuma conexão WhatsApp WAHA com suporte a grupos foi encontrada. Conecte ou ative uma conta WAHA em Conexões e volte para listar os grupos.
                </p>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border bg-card">
              {gruposEncontrados.length > 0 ? (
                <div>
                  <div className="flex flex-col gap-2 border-b bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <Input
                      value={filtroGrupos}
                      onChange={(event) => setFiltroGrupos(event.target.value)}
                      placeholder="Pesquisar grupo pelo nome…"
                      aria-label="Pesquisar grupo pelo nome"
                    />
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {gruposEncontradosVisiveis.length} de {gruposEncontrados.length} grupo(s)
                    </p>
                  </div>
                  {gruposEncontradosVisiveis.length === 0 ? (
                    <EstadoVazio texto="Nenhum grupo corresponde à pesquisa." />
                  ) : (
                    <div className="divide-y">
                  {gruposEncontradosVisiveis.map((g) => (
                    <div key={g.externalId} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-medium">{g.name}</h3>
                          <Badge variant={g.groupKind === "announcement" ? "secondary" : "outline"}>
                            {g.groupKind === "announcement"
                              ? "Grupo de avisos"
                              : g.groupKind === "community"
                                ? "Comunidade"
                                : "Grupo normal"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {g.participantCount === null
                            ? "Participantes não informados"
                            : `${g.participantCount} participante(s)`}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{g.externalId}</p>
                      </div>
                      <Button size="sm" onClick={() => void salvarGrupoEncontrado(g)} disabled={!podeEditar || salvando}>
                        Salvar
                      </Button>
                    </div>
                  ))}
                    </div>
                  )}
                </div>
              ) : grupos.length === 0 ? (
                <EstadoVazio texto="Nenhum grupo salvo ainda." />
              ) : (
                <div className="divide-y">
                  {grupos.map((g) => (
                    <div key={g.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-medium">{g.name}</h3>
                          <Badge variant={g.is_active ? "default" : "secondary"}>{g.is_active ? "Ativo" : "Inativo"}</Badge>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{g.external_group_id}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{dataCurta(g.last_seen_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {aba === "historico" && (
          <div className="overflow-hidden rounded-lg border bg-card">
            {execucoes.length === 0 ? (
              <EstadoVazio texto="Nenhuma execução registrada ainda." />
            ) : (
              <div className="divide-y">
                {execucoes.map((e) => (
                  <div key={e.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-medium">
                          {e.scheduled_group_messages?.title || "Envio agendado"}
                        </h3>
                        <Badge variant={badgeExecucao(e.status)}>{EXECUCAO_LABEL[e.status]}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {e.scheduled_whatsapp_groups?.name ?? "Grupo"} · Programado para {dataCurta(e.scheduled_for)}
                      </p>
                      {e.error_message ? <p className="mt-1 text-xs text-destructive">{e.error_message}</p> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{e.sent_at ? `Enviado ${dataCurta(e.sent_at)}` : e.error_code ?? ""}</p>
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

function Resumo({ titulo, valor, detalhe, icone }: { titulo: string; valor: number; detalhe: string; icone: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{titulo}</p>
          <p className="mt-1 text-2xl font-semibold">{valor}</p>
        </div>
        <div className="rounded-md border bg-muted p-2 text-muted-foreground">{icone}</div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{detalhe}</p>
    </div>
  );
}

function EstadoVazio({ texto }: { texto: string }) {
  return <div className="p-8 text-center text-sm text-muted-foreground">{texto}</div>;
}
