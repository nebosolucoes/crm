"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { GrupoSelecionavel } from "@/components/disparo/SeletorDeGrupos";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { subirMidia, urlAssinadaDaMidia, useContasPublicaveis, useMutacoesDePublicacao, usePublicacao } from "@/hooks/publicacoes/usePublicacoes";
import { apiClient } from "@/lib/api/client";
import { validarDestino } from "@/lib/publicacoes/regras-por-destino";
import type { CriarPublicacao, DestinoDaPublicacao, MidiaDaPublicacao, RecorrenciaDaPublicacao } from "@/lib/publicacoes/schema";
import type { PublicacaoLida } from "@/lib/publicacoes/servico";
import { horaLocal, paredeParaInstante, proximaHoraCheia } from "@/lib/publicacoes/tempo-da-tela";

import { DropzoneDeMidia, type AnexoLocal } from "./DropzoneDeMidia";
import { SeletorDeDestinos, chaveDoDestino } from "./SeletorDeDestinos";
import { SeletorDeHorarios, destinosDaLinha, type HorarioDaTela } from "./SeletorDeHorarios";
import type { MidiaDaPrevia } from "./previa/Aparelho";
import { PreviaDosDestinos } from "./previa/PreviaDosDestinos";
import { ROTULO_DA_REDE, ROTULO_DO_FORMATO } from "./rotulos";

/**
 * O fluxo único de criar/editar, na ordem em que a pessoa pensa:
 * 1. Redes (onde sai) → 2. Conteúdo (o quê) → 3. Data e horário (quando, e
 * quais redes em cada data) → 4. Prévia (como vai aparecer). Um clique em
 * Agendar. O que a API faz com isso (ocorrências, execuções, provedores)
 * não aparece.
 *
 * Duas camadas: o carregador (`FormularioDePublicacao`) busca a publicação a
 * editar e as URLs das mídias; o formulário (`Formulario`) nasce já com o
 * estado inicial — sem `setState` dentro de efeito.
 */
export interface EstadoInicial {
  titulo: string;
  legenda: string;
  anexos: AnexoLocal[];
  destinos: DestinoDaPublicacao[];
  horarios: HorarioDaTela[];
  recorrencia: RecorrenciaDaPublicacao;
}

export function FormularioDePublicacao({ fuso, editarId, diaSugerido, agoraIso }: { fuso: string; editarId: string | null; diaSugerido: string | null; agoraIso: string }) {
  const t = useT();
  const { data: existente, isLoading } = usePublicacao(editarId);
  const { data: inicial, isLoading: montando } = useQuery({
    queryKey: ["publicacoes", "estado-inicial", editarId, existente?.updated_at ?? null, diaSugerido],
    queryFn: async () => estadoInicial(existente ?? null, fuso, diaSugerido, new Date(agoraIso)),
    enabled: !editarId || !!existente,
    staleTime: Infinity,
  });

  if ((editarId && isLoading) || montando || !inicial) {
    if (editarId && !isLoading && !existente) return <p className="text-sm text-muted-foreground">{t("Publicação não encontrada.")}</p>;
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return <Formulario key={`${editarId ?? "nova"}:${existente?.updated_at ?? ""}`} fuso={fuso} editarId={editarId} inicial={inicial} />;
}

async function estadoInicial(existente: PublicacaoLida | null, fuso: string, diaSugerido: string | null, agora: Date): Promise<EstadoInicial> {
  const primeiraData = () => {
    if (diaSugerido) {
      const iso = paredeParaInstante(`${diaSugerido}T09:00`, fuso);
      if (iso && new Date(iso).getTime() > agora.getTime()) return iso;
    }
    return proximaHoraCheia(agora, fuso);
  };
  if (!existente) {
    return { titulo: "", legenda: "", anexos: [], destinos: [], horarios: [{ iso: primeiraData(), excluidos: [] }], recorrencia: { kind: "none", config: {}, repeat_until: null, max_occurrences: null } };
  }
  const anexos = await Promise.all(
    existente.media.map(async (m): Promise<AnexoLocal> => ({
      id: m.id,
      kind: m.kind as AnexoLocal["kind"],
      nome: m.filename ?? m.storage_path.split("/").pop() ?? m.kind,
      mime: m.mime,
      sizeBytes: m.size_bytes,
      file: null,
      salvo: { id: m.id, kind: m.kind as MidiaDaPublicacao["kind"], storage_path: m.storage_path, mime: m.mime, size_bytes: m.size_bytes, filename: m.filename, width: m.width, height: m.height, duration_ms: m.duration_ms, cover_storage_path: m.cover_storage_path },
      url: m.kind === "image" || m.kind === "video" ? await urlAssinadaDaMidia(m.storage_path) : null,
      width: m.width,
      height: m.height,
      duration_ms: m.duration_ms,
      enviando: false,
    })),
  );
  const vivos = existente.targets.filter((d) => !d.removido);
  const chavePorId = new Map(vivos.map((d) => [d.id, chaveDoDestino(d)]));
  // Cada data pendente traz os destinos que escolheu (0284); sem escolha, todos.
  const horarios: HorarioDaTela[] = existente.occurrences
    .filter((o) => o.status === "pending" && o.source === "manual")
    .map((o) => {
      const escolhidos = o.target_ids ? new Set(o.target_ids) : null;
      return { iso: o.scheduled_at, excluidos: escolhidos ? vivos.filter((d) => !escolhidos.has(d.id)).map((d) => chavePorId.get(d.id)!) : [] };
    });
  return {
    titulo: existente.title ?? "",
    legenda: existente.body ?? "",
    anexos,
    destinos: vivos.map((d) => ({ id: d.id, network: d.network, format: d.format, channel_session_id: d.channel_session_id, group_ids: d.group_ids, settings: d.settings as DestinoDaPublicacao["settings"] })),
    horarios: horarios.length > 0 ? horarios : [{ iso: primeiraData(), excluidos: [] }],
    recorrencia: {
      kind: existente.recurrence.kind,
      config: existente.recurrence.config as RecorrenciaDaPublicacao["config"],
      repeat_until: existente.recurrence.repeat_until,
      max_occurrences: existente.recurrence.max_occurrences,
    },
  };
}

function Formulario({ fuso, editarId, inicial }: { fuso: string; editarId: string | null; inicial: EstadoInicial }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const router = useRouter();
  const { data: contas, isLoading: carregandoContas } = useContasPublicaveis();
  const { data: grupos } = useQuery({
    queryKey: ["publicacoes", "grupos-salvos"],
    // A rota (herdada do Disparo) embrulha a lista em `groups`.
    queryFn: async () => (await apiClient.get<{ data: { groups: GrupoSelecionavel[] } }>("/api/v1/agendamentos/grupos?active=true")).data.groups ?? [],
    staleTime: 30_000,
  });
  const { criar, editar } = useMutacoesDePublicacao();

  const [titulo, setTitulo] = useState(inicial.titulo);
  const [legenda, setLegenda] = useState(inicial.legenda);
  const [anexos, setAnexos] = useState<AnexoLocal[]>(inicial.anexos);
  const [destinos, setDestinos] = useState<DestinoDaPublicacao[]>(inicial.destinos);
  const [horarios, setHorarios] = useState<HorarioDaTela[]>(inicial.horarios);
  const [recorrencia, setRecorrencia] = useState<RecorrenciaDaPublicacao>(inicial.recorrencia);
  const [salvando, setSalvando] = useState<null | "draft" | "scheduled">(null);

  // Regras por formato, a cada mudança — a mesma tabela que a API confere.
  const veredito = useMemo(() => {
    const media = anexos.map((a) => ({ kind: a.kind, mime: a.mime, size_bytes: a.sizeBytes, width: a.width, height: a.height, duration_ms: a.duration_ms }));
    const saida: Record<string, { erros: ReturnType<typeof validarDestino>["erros"]; avisos: ReturnType<typeof validarDestino>["avisos"] }> = {};
    for (const d of destinos) {
      const v = validarDestino({ network: d.network, format: d.format, body: legenda, media, groupCount: d.group_ids?.length ?? 0 });
      saida[chaveDoDestino(d)] = { erros: v.erros, avisos: v.avisos };
    }
    return saida;
  }, [anexos, destinos, legenda]);
  const temErro = Object.values(veredito).some((v) => v.erros.length > 0);

  /** Desmarcar uma rede no passo 1 a tira também das datas que a tinham desligado. */
  function mudarDestinos(proximos: DestinoDaPublicacao[]) {
    const chaves = new Set(proximos.map(chaveDoDestino));
    setDestinos(proximos);
    setHorarios((atual) => atual.map((h) => ({ ...h, excluidos: h.excluidos.filter((k) => chaves.has(k)) })));
  }

  async function subirPendentes(): Promise<MidiaDaPublicacao[]> {
    const saida: MidiaDaPublicacao[] = [];
    for (const a of anexos) {
      if (a.salvo) {
        saida.push(a.salvo);
        continue;
      }
      if (!a.file) continue;
      setAnexos((atual) => atual.map((x) => (x.id === a.id ? { ...x, enviando: true } : x)));
      const salvo = await subirMidia(a.file, { width: a.width, height: a.height, duration_ms: a.duration_ms });
      setAnexos((atual) => atual.map((x) => (x.id === a.id ? { ...x, salvo, enviando: false } : x)));
      saida.push(salvo);
    }
    return saida;
  }

  async function salvar(status: "draft" | "scheduled") {
    if (status === "scheduled") {
      if (destinos.length === 0) {
        toast.error(t("Escolha pelo menos um destino."));
        return;
      }
      if (horarios.length === 0) {
        toast.error(t("Escolha pelo menos uma data e hora."));
        return;
      }
      if (temErro) {
        toast.error(t("Há destinos com problema. Ajuste antes de agendar."));
        return;
      }
    }
    setSalvando(status);
    try {
      const media = await subirPendentes();
      const corpo: CriarPublicacao = {
        title: titulo.trim() || null,
        body: legenda.trim() || null,
        status,
        timezone: fuso,
        media,
        targets: destinos,
        scheduled_at: horarios.map((h) => h.iso),
        occurrences: horarios.map((h) => ({ scheduled_at: h.iso, targets: destinosDaLinha(h, destinos) })),
        recurrence: recorrencia,
      };
      if (editarId) await editar.mutateAsync({ id: editarId, entrada: corpo });
      else await criar.mutateAsync(corpo);
      toast.success(status === "draft" ? t("Rascunho salvo.") : editarId ? t("Publicação atualizada.") : t("Publicação agendada."));
      router.push("/app/publicacoes/lista");
    } catch (err) {
      showApiError(err);
    } finally {
      setSalvando(null);
    }
  }

  const grupoNome = useMemo(() => new Map((grupos ?? []).map((g) => [g.id, g.name])), [grupos]);
  const nomesDosGrupos = (ids: string[]) => ids.map((id) => grupoNome.get(id) ?? "").filter(Boolean);
  const midiasDaPrevia: MidiaDaPrevia[] = anexos.map((a) => ({ id: a.id, kind: a.kind, url: a.url, nome: a.nome, width: a.width, height: a.height }));
  const primeira = horarios[0]?.iso ?? null;
  const dataLegenda = primeira ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", timeZone: fuso }).format(new Date(primeira)) : "";
  const resumoDosDestinos = destinos.map((d) => `${ROTULO_DA_REDE[d.network]} · ${d.network === "whatsapp" ? `${d.group_ids?.length ?? 0} ${t("grupos")}` : t(ROTULO_DO_FORMATO[d.format])}`);
  const ocupado = salvando !== null;

  // O que falta para agendar — a lista que desativa o botão e vira o tooltip.
  const pendencias: string[] = [];
  if (destinos.length === 0) pendencias.push(t("Marque pelo menos um destino."));
  if (horarios.length === 0) pendencias.push(t("Escolha pelo menos uma data e hora."));
  if (!legenda.trim() && anexos.length === 0) pendencias.push(t("Escreva uma legenda ou anexe um arquivo."));
  for (const d of destinos) {
    const v = veredito[chaveDoDestino(d)];
    for (const e of v?.erros ?? []) {
      pendencias.push(`${ROTULO_DA_REDE[d.network]} · ${t(ROTULO_DO_FORMATO[d.format])}: ${t(e.mensagem)}`);
    }
  }
  for (const [i, h] of horarios.entries()) {
    if (destinos.length > 0 && destinosDaLinha(h, destinos)?.length === 0) pendencias.push(`${i + 1}ª ${t("data")}: ${t("Esta data está sem nenhuma rede.")}`);
  }
  const podeAgendar = pendencias.length === 0;

  const botaoAgendar = (
    <Button type="button" onClick={() => void salvar("scheduled")} disabled={ocupado || !podeAgendar} aria-disabled={!podeAgendar} data-testid="agendar-publicacao">
      {salvando === "scheduled" ? t("Agendando…") : editarId ? t("Salvar alterações") : t("Agendar publicação")}
    </Button>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,1fr)_minmax(320px,1fr)] xl:grid-cols-[minmax(340px,1fr)_minmax(380px,1.2fr)_minmax(360px,0.95fr)] xl:gap-8" data-testid="formulario-em-colunas">
        {/* 1ª coluna: as redes e, embaixo, as datas — cada data com as redes que saem nela */}
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="passo-destinos">
            <h2 id="passo-destinos" className="flex items-center gap-2 text-base font-semibold">
              <Passo n={1} />
              {t("Redes")}
            </h2>
            {carregandoContas ? <Skeleton className="h-12 w-full" /> : <SeletorDeDestinos contas={contas ?? []} grupos={grupos ?? []} destinos={destinos} onChange={mudarDestinos} veredito={veredito} disabled={ocupado} />}
          </section>

          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="passo-horarios">
            <h2 id="passo-horarios" className="flex items-center gap-2 text-base font-semibold">
              <Passo n={3} />
              {t("Data e horário")}
            </h2>
            <p className="-mt-1 text-xs text-muted-foreground">{t("Em cada data, apague o ícone da rede que não deve sair nela.")}</p>
            <SeletorDeHorarios horarios={horarios} onChange={setHorarios} destinos={destinos} recorrencia={recorrencia} onRecorrencia={setRecorrencia} fuso={fuso} disabled={ocupado} />
          </section>
        </div>

        {/* 2ª coluna: o conteúdo */}
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="passo-conteudo">
          <h2 id="passo-conteudo" className="flex items-center gap-2 text-base font-semibold">
            <Passo n={2} />
            {t("Conteúdo")}
          </h2>
          <DropzoneDeMidia anexos={anexos} onChange={setAnexos} disabled={ocupado} />
          <div className="grid gap-2">
            <Label htmlFor="pub-legenda">{t("Legenda")}</Label>
            <Textarea id="pub-legenda" value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder={t("O texto que sai no post e na mensagem. No WhatsApp, *negrito* e _itálico_ funcionam.")} rows={7} maxLength={4000} disabled={ocupado} data-testid="pub-legenda" />
            <span className="text-right text-[11px] text-muted-foreground">{legenda.length}/4000</span>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pub-titulo">{t("Título (só para você achar depois)")}</Label>
            <Input id="pub-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={t("Ex.: Oferta Coca-Cola")} maxLength={160} disabled={ocupado} data-testid="pub-titulo" />
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-4">
            {podeAgendar ? (
              botaoAgendar
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex" data-testid="agendar-bloqueado">
                    {botaoAgendar}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs" data-testid="tooltip-pendencias">
                  <p className="font-medium">{t("Falta para agendar:")}</p>
                  <ul className="mt-1 list-disc pl-4">
                    {pendencias.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            )}
            <Button type="button" variant="outline" onClick={() => void salvar("draft")} disabled={ocupado} data-testid="salvar-rascunho">
              {salvando === "draft" ? t("Salvando…") : t("Salvar como rascunho")}
            </Button>
            {editarId ? <span className="text-xs text-muted-foreground">{t("Salvar altera todas as datas pendentes desta publicação.")}</span> : null}
          </div>
        </section>

        {/* 3ª coluna: como vai aparecer */}
        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-2 xl:self-start" aria-labelledby="passo-previa">
          <h2 id="passo-previa" className="flex items-center gap-2 text-base font-semibold">
            <Passo n={4} />
            {t("Prévia")}
          </h2>
          <PreviaDosDestinos
            destinos={destinos}
            contas={contas ?? []}
            nomesDosGrupos={nomesDosGrupos}
            midias={midiasDaPrevia}
            legenda={legenda}
            hora={primeira ? horaLocal(primeira, fuso) : "--:--"}
            dataLegenda={dataLegenda}
          />
          <div className="rounded-xl border bg-card p-3 text-sm">
            <ul className="flex flex-col gap-1">
              <li>
                {anexos.length} {anexos.length === 1 ? t("arquivo") : t("arquivos")}
              </li>
              {resumoDosDestinos.length > 0 ? resumoDosDestinos.map((r) => <li key={r}>{r}</li>) : <li className="text-muted-foreground">{t("Nenhum destino ainda")}</li>}
              <li>
                {horarios.length} {horarios.length === 1 ? t("data") : t("datas")}
                {recorrencia.kind !== "none" ? ` · ${t("com repetição")}` : ""}
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </TooltipProvider>
  );
}

function Passo({ n }: { n: number }) {
  return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">{n}</span>;
}
