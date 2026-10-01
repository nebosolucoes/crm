"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type { EstadoDoDestino } from "@/lib/publicacoes/estado-do-destino";
import type { OcorrenciaResumida, ResumoDeDestino } from "@/lib/publicacoes/servico";
import { diaLocal, diasDaGradeDoMes, horaLocal } from "@/lib/publicacoes/tempo-da-tela";
import { CaretLeft, CaretRight } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { ChannelIcon, formatoParaChannelFormat } from "./ChannelIcon";
import { ROTULO_DA_REDE } from "./rotulos";

const POR_DIA_VISIVEIS = 3;

/** Um chip do calendário: UM destino de UMA data — o Instagram e o Facebook da mesma publicação são dois chips. */
export interface ItemDoCalendario {
  chave: string;
  ocorrencia: OcorrenciaResumida;
  destino: ResumoDeDestino;
  estado: EstadoDoDestino;
}

/** Os itens de uma lista de ocorrências: um por destino da data, com o estado daquele destino. */
export function itensDoCalendario(ocorrencias: OcorrenciaResumida[]): ItemDoCalendario[] {
  return ocorrencias.flatMap((o) =>
    o.targets.map((d) => ({ chave: `${o.id}:${d.id}`, ocorrencia: o, destino: d, estado: o.destinos_estado?.[d.id] ?? "programado" })),
  );
}

/** Amarelo = programado, verde = concluído, vermelho = falhou; cancelado fica neutro e riscado. */
const COR_DO_ESTADO: Record<EstadoDoDestino, string> = {
  programado: "border-warning-fg/30 bg-warning-bg text-warning-fg",
  concluido: "border-success-fg/30 bg-success-bg text-success-fg",
  falhou: "border-error-fg/30 bg-error-bg text-error-fg",
  cancelado: "border-border bg-muted text-muted-foreground",
};

/**
 * A primeira linha do chip: o nome da conexão (o @, a Página, o número). O
 * ícone ao lado já diz a rede e o formato, e a célula tem um sétimo da
 * largura — "Instagram · @conta" cortava antes da conta. Sem nome, a rede.
 */
function nomeDaConexao(d: ResumoDeDestino): string {
  return d.display_name?.trim() || ROTULO_DA_REDE[d.network];
}

/**
 * O mês, como a vista Mês da Agenda de atendimento: seis semanas sempre (a
 * grade não pula ao virar o mês), dias de fora esmaecidos, hoje em destaque,
 * "+N" quando o dia passa de três chips. Cada chip é um DESTINO numa data:
 * o ícone da rede e formato à esquerda (o mesmo do Agendar), a conexão, o
 * título e a hora, com a cor do estado daquele destino.
 *
 * O dia de cada chip é o dia no FUSO da organização, nunca o do navegador.
 * Em tela estreita a grade vira lista por dia.
 */
export function CalendarioDePublicacoes({
  ano,
  mes,
  itens,
  fuso,
  selecionadaId,
  onMover,
  onHoje,
  onAbrir,
  onNovaNoDia,
}: {
  ano: number;
  /** 1–12 */
  mes: number;
  itens: ItemDoCalendario[] | undefined;
  fuso: string;
  selecionadaId: string | null;
  onMover: (delta: number) => void;
  onHoje: () => void;
  onAbrir: (o: OcorrenciaResumida) => void;
  onNovaNoDia?: (chave: string) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const hoje = diaLocal(new Date(), fuso);

  // Seis semanas sempre, começando no domingo: os buracos de `diasDaGradeDoMes`
  // viram os dias do mês anterior e do seguinte, esmaecidos.
  const semanas = useMemo(() => {
    const grade = diasDaGradeDoMes(ano, mes);
    const antes = grade.findIndex((c) => c !== null);
    const inicio = Date.UTC(ano, mes - 1, 1 - antes);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(inicio + i * 86_400_000);
      const chave = d.toISOString().slice(0, 10);
      return { chave, dia: d.getUTCDate(), doMes: d.getUTCMonth() === mes - 1 };
    });
  }, [ano, mes]);

  const porDia = useMemo(() => {
    const m = new Map<string, ItemDoCalendario[]>();
    const ordenados = [...(itens ?? [])].sort(
      (a, b) => a.ocorrencia.scheduled_at.localeCompare(b.ocorrencia.scheduled_at) || a.destino.network.localeCompare(b.destino.network) || a.destino.format.localeCompare(b.destino.format),
    );
    for (const it of ordenados) {
      const k = diaLocal(it.ocorrencia.scheduled_at, fuso);
      const lista = m.get(k) ?? [];
      lista.push(it);
      m.set(k, lista);
    }
    return m;
  }, [itens, fuso]);

  const nomeDoMes = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(ano, mes - 1, 1)));
  const diaDaSemana = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  const cabecalhos = Array.from({ length: 7 }, (_, i) => diaDaSemana.format(new Date(Date.UTC(2026, 2, 1 + i))).replace(".", ""));
  const diaLongo = new Intl.DateTimeFormat(tag, { weekday: "long", day: "2-digit", timeZone: "UTC" });

  const chip = (it: ItemDoCalendario) => {
    const titulo = it.ocorrencia.title?.trim() || t("Sem título");
    const hora = horaLocal(it.ocorrencia.scheduled_at, fuso);
    const conexao = nomeDaConexao(it.destino);
    return (
      <button
        key={it.chave}
        type="button"
        title={`${ROTULO_DA_REDE[it.destino.network]} · ${conexao} · ${titulo} · ${hora}`}
        data-testid={`chip-${it.ocorrencia.id}`}
        data-destino={`${it.destino.network}-${it.destino.format}`}
        data-estado={it.estado}
        onClick={(e) => {
          e.stopPropagation();
          onAbrir(it.ocorrencia);
        }}
        className={cn(
          "flex w-full min-w-0 items-stretch gap-1.5 rounded-md border p-1 text-left transition-shadow hover:shadow-sm",
          COR_DO_ESTADO[it.estado],
          selecionadaId === it.ocorrencia.id && "ring-2 ring-accent-500",
        )}
      >
        <span className="flex shrink-0 items-center">
          <ChannelIcon channel={it.destino.network} format={formatoParaChannelFormat(it.destino.format)} size={34} decorative />
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
          <span className="truncate text-[11px] font-semibold">{conexao}</span>
          <span className={cn("truncate text-[11px] text-text", it.estado === "cancelado" && "line-through")}>{titulo}</span>
          <span className="text-[10px] tabular-nums opacity-80">{hora}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card" data-testid="calendario-de-publicacoes">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Mês anterior")} onClick={() => onMover(-1)}>
            <CaretLeft size={16} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Próximo mês")} onClick={() => onMover(1)}>
            <CaretRight size={16} aria-hidden />
          </Button>
          <h2 className="ml-1 text-sm font-semibold first-letter:uppercase" data-testid="calendario-mes">
            {nomeDoMes}
          </h2>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={onHoje}>
          {t("Hoje")}
        </Button>
      </div>

      {/* Grade (≥ sm) */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 border-b">
          {cabecalhos.map((r) => (
            <div key={r} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {r}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {semanas.map((celula) => {
            const doDia = porDia.get(celula.chave) ?? [];
            const excedente = doDia.length - POR_DIA_VISIVEIS;
            const ehHoje = celula.chave === hoje;
            return (
              <div
                key={celula.chave}
                data-testid={`celula-${celula.chave}`}
                className={cn(
                  "flex min-h-28 min-w-0 flex-col gap-1 border-r border-b p-1 [&:nth-child(7n)]:border-r-0",
                  !celula.doMes && "bg-muted/30",
                  onNovaNoDia && "cursor-pointer transition-colors hover:bg-muted/40",
                )}
                onClick={onNovaNoDia ? () => onNovaNoDia(celula.chave) : undefined}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span
                    className={cn(
                      "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums",
                      ehHoje ? "bg-accent font-semibold text-accent-foreground" : celula.doMes ? "text-text" : "text-text-subtle",
                    )}
                  >
                    {celula.dia}
                  </span>
                  {excedente > 0 ? (
                    <button
                      type="button"
                      className="text-[10px] font-semibold tabular-nums text-text-subtle hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAbrir(doDia[POR_DIA_VISIVEIS]!.ocorrencia);
                      }}
                    >
                      +{excedente}
                    </button>
                  ) : null}
                </div>
                {doDia.slice(0, POR_DIA_VISIVEIS).map(chip)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista por dia (< sm) */}
      <div className="divide-y sm:hidden">
        {semanas
          .filter((c) => c.doMes)
          .map((celula) => {
            const doDia = porDia.get(celula.chave) ?? [];
            if (doDia.length === 0) return null;
            return (
              <div key={celula.chave} className="flex flex-col gap-1 px-3 py-2">
                <span className={cn("text-xs font-semibold first-letter:uppercase", celula.chave === hoje ? "text-accent" : "text-muted-foreground")}>
                  {diaLongo.format(new Date(`${celula.chave}T12:00:00Z`))}
                </span>
                {doDia.map(chip)}
              </div>
            );
          })}
        {porDia.size === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("Nada agendado neste mês.")}</p> : null}
      </div>
    </div>
  );
}
