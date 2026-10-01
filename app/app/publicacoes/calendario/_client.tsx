"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CabecalhoDePublicacoes } from "@/components/publicacoes/Cabecalho";
import { CalendarioDePublicacoes, itensDoCalendario, type ItemDoCalendario } from "@/components/publicacoes/CalendarioDePublicacoes";
import { DialogoDeCancelar, DialogoDeReagendar } from "@/components/publicacoes/DialogosDeOcorrencia";
import { nomeDaContaPublicavel } from "@/components/publicacoes/SeletorDeDestinos";
import { SheetDaOcorrencia } from "@/components/publicacoes/SheetDaOcorrencia";
import { ROTULO_DA_REDE } from "@/components/publicacoes/rotulos";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useContasPublicaveis, useOcorrencias, useRealtimeDePublicacoes } from "@/hooks/publicacoes/usePublicacoes";
import { partesNoFuso } from "@/lib/agenda/fuso";
import type { EstadoDoDestino } from "@/lib/publicacoes/estado-do-destino";
import { limitesDoMes } from "@/lib/publicacoes/tempo-da-tela";
import { cn } from "@/lib/utils";

/**
 * As abas do Calendário, no mesmo desenho das da Agenda de atendimento. Cada
 * uma diz quais estados de destino ela mostra; "Todos" inclui os cancelados.
 */
const ABAS: ReadonlyArray<{ id: "todos" | "programado" | "concluido" | "falhou"; rotulo: string; estados: ReadonlyArray<EstadoDoDestino> }> = [
  { id: "todos", rotulo: "Todos", estados: ["programado", "concluido", "falhou", "cancelado"] },
  { id: "programado", rotulo: "Programado", estados: ["programado"] },
  { id: "concluido", rotulo: "Concluído", estados: ["concluido"] },
  { id: "falhou", rotulo: "Falhou", estados: ["falhou"] },
];
type AbaDoCalendario = (typeof ABAS)[number]["id"];

const TODAS_AS_CONEXOES = "todas";

/** Calendário: o mês, um chip por destino em cada data, filtrável por situação e por conexão. */
export function CalendarioClient({ podeEditar, fuso }: { podeEditar: boolean; fuso: string }) {
  const t = useT();
  const router = useRouter();
  const hoje = partesNoFuso(new Date(), fuso);
  const [ano, setAno] = useState(hoje.ano);
  const [mes, setMes] = useState(hoje.mes);
  const intervalo = useMemo(() => ({ ...limitesDoMes(ano, mes, fuso), incluir: "todas" as const }), [ano, mes, fuso]);
  const { data } = useOcorrencias(intervalo);
  const { data: contas } = useContasPublicaveis();
  useRealtimeDePublicacoes();

  const [aba, setAba] = useState<AbaDoCalendario>("todos");
  const [conexao, setConexao] = useState<string>(TODAS_AS_CONEXOES);
  const [aberta, setAberta] = useState<string | null>(null);
  const [reagendar, setReagendar] = useState<{ id: string; scheduledAt: string } | null>(null);
  const [cancelar, setCancelar] = useState<{ tipo: "ocorrencia"; id: string } | { tipo: "publicacao"; id: string } | { tipo: "excluir"; id: string } | null>(null);

  // Primeiro a conexão (ela muda os contadores), depois a aba.
  const daConexao = useMemo<ItemDoCalendario[]>(() => {
    const todos = itensDoCalendario(data ?? []);
    return conexao === TODAS_AS_CONEXOES ? todos : todos.filter((it) => it.destino.channel_session_id === conexao);
  }, [data, conexao]);
  const contagem = useMemo(() => {
    const c = {} as Record<AbaDoCalendario, number>;
    for (const a of ABAS) c[a.id] = daConexao.filter((it) => a.estados.includes(it.estado)).length;
    return c;
  }, [daConexao]);
  const visiveis = useMemo(() => {
    const estados = ABAS.find((a) => a.id === aba)!.estados;
    return daConexao.filter((it) => estados.includes(it.estado));
  }, [daConexao, aba]);

  function mover(delta: number) {
    const alvo = new Date(Date.UTC(ano, mes - 1 + delta, 1));
    setAno(alvo.getUTCFullYear());
    setMes(alvo.getUTCMonth() + 1);
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6 pt-0">
      <CabecalhoDePublicacoes titulo={t("Calendário")} descricao={t("O mês inteiro de uma vez: cada chip é uma rede numa data, com a cor do resultado.")} podeEditar={podeEditar} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t("Filtrar por situação")} className="flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-surface p-0.5" data-testid="abas-do-calendario">
          {ABAS.map((a) => (
            <button
              key={a.id}
              role="tab"
              type="button"
              data-testid={`aba-${a.id}`}
              aria-selected={aba === a.id}
              onClick={() => setAba(a.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors duration-fast ease-out",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
                aba === a.id ? "bg-accent font-semibold text-accent-foreground" : "text-text-muted hover:bg-surface-elevated hover:text-text",
              )}
            >
              <span>{t(a.rotulo)}</span>
              {/* O contador vem sempre, inclusive zero — como na Agenda. */}
              <span
                data-testid={`contador-${a.id}`}
                className={cn("rounded-full px-1.5 text-[10px] tabular-nums", aba === a.id ? "bg-accent-foreground/20" : "bg-surface-elevated text-text-subtle")}
              >
                {contagem[a.id]}
              </span>
            </button>
          ))}
        </div>

        <Select value={conexao} onValueChange={setConexao}>
          <SelectTrigger className="h-8 w-[240px] text-xs" aria-label={t("Filtrar por conexão")} data-testid="filtro-de-conexao">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS_AS_CONEXOES}>{t("Todas as conexões")}</SelectItem>
            {(contas ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {ROTULO_DA_REDE[c.network]} · {nomeDaContaPublicavel(c.network, c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <CalendarioDePublicacoes
        ano={ano}
        mes={mes}
        itens={data ? visiveis : undefined}
        fuso={fuso}
        selecionadaId={aberta}
        onMover={mover}
        onHoje={() => {
          setAno(hoje.ano);
          setMes(hoje.mes);
        }}
        onAbrir={(o) => setAberta(o.id)}
        onNovaNoDia={podeEditar ? (chave) => router.push(`/app/publicacoes/agendar?dia=${chave}`) : undefined}
      />
      <SheetDaOcorrencia
        ocorrenciaId={aberta}
        fuso={fuso}
        podeEditar={podeEditar}
        onFechar={() => setAberta(null)}
        onAlterarHorario={(id, scheduledAt) => setReagendar({ id, scheduledAt })}
        onCancelarOcorrencia={(id) => setCancelar({ tipo: "ocorrencia", id })}
        onCancelarPublicacao={(id) => setCancelar({ tipo: "publicacao", id })}
        onExcluir={(id) => setCancelar({ tipo: "excluir", id })}
      />
      <DialogoDeReagendar ocorrenciaId={reagendar?.id ?? null} scheduledAt={reagendar?.scheduledAt ?? null} fuso={fuso} aberto={reagendar !== null} onFechar={() => setReagendar(null)} />
      <DialogoDeCancelar alvo={cancelar} aberto={cancelar !== null} onFechar={() => setCancelar(null)} onFeito={() => setAberta(null)} />
    </div>
  );
}
