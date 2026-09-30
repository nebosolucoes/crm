"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type { OcorrenciaResumida } from "@/lib/publicacoes/servico";
import { diaLocal, diasDaGradeDoMes, horaLocal } from "@/lib/publicacoes/tempo-da-tela";
import { CaretLeft, CaretRight } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { PontosDasRedes } from "./ChipsDeDestino";

const POR_DIA_VISIVEIS = 3;

/**
 * O mês, uma célula por dia, UM chip por ocorrência (uma publicação com 8
 * fotos, 5 Stories e três redes é um chip só — o Sheet abre o resto). Mais de
 * três no dia vira "+N". Em tela estreita a grade vira lista por dia.
 *
 * O dia de cada ocorrência é o dia no FUSO da organização, nunca o do navegador.
 */
export function CalendarioDePublicacoes({
  ano,
  mes,
  ocorrencias,
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
  ocorrencias: OcorrenciaResumida[] | undefined;
  fuso: string;
  selecionadaId: string | null;
  onMover: (delta: number) => void;
  onHoje: () => void;
  onAbrir: (o: OcorrenciaResumida) => void;
  onNovaNoDia?: (chave: string) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const grade = useMemo(() => diasDaGradeDoMes(ano, mes), [ano, mes]);
  const hoje = diaLocal(new Date(), fuso);
  const porDia = useMemo(() => {
    const m = new Map<string, OcorrenciaResumida[]>();
    for (const o of [...(ocorrencias ?? [])].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
      const k = diaLocal(o.scheduled_at, fuso);
      const lista = m.get(k) ?? [];
      lista.push(o);
      m.set(k, lista);
    }
    return m;
  }, [ocorrencias, fuso]);
  const nomeDoMes = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(ano, mes - 1, 1)));
  const diaDaSemana = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  const cabecalhos = Array.from({ length: 7 }, (_, i) => diaDaSemana.format(new Date(Date.UTC(2026, 2, 1 + i))));
  const diaLongo = new Intl.DateTimeFormat(tag, { weekday: "long", day: "2-digit", timeZone: "UTC" });

  const chip = (o: OcorrenciaResumida) => (
    <button
      key={o.id}
      type="button"
      title={`${horaLocal(o.scheduled_at, fuso)} · ${o.title?.trim() || t("Publicação sem título")}`}
      data-testid={`chip-${o.id}`}
      onClick={(e) => {
        e.stopPropagation();
        onAbrir(o);
      }}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium",
        o.status === "pending" || o.status === "processing" ? "bg-accent-soft text-accent" : o.status === "done" ? "bg-success-bg text-success-fg" : o.status === "cancelled" ? "bg-muted text-muted-foreground line-through" : "bg-warning-bg text-warning-fg",
        selecionadaId === o.id && "ring-2 ring-accent-500",
      )}
    >
      <span className="tabular-nums">{horaLocal(o.scheduled_at, fuso)}</span>
      <span className="truncate">{o.title?.trim() || t("Sem título")}</span>
      <PontosDasRedes targets={o.targets} />
    </button>
  );

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="calendario-de-publicacoes">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3 sm:px-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Mês anterior")} onClick={() => onMover(-1)}>
            <CaretLeft size={16} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Próximo mês")} onClick={() => onMover(1)}>
            <CaretRight size={16} aria-hidden />
          </Button>
        </div>
        <h2 className="text-base font-semibold capitalize" data-testid="calendario-mes">
          {nomeDoMes}
        </h2>
        <Button variant="outline" size="sm" className="h-8" onClick={onHoje}>
          {t("Hoje")}
        </Button>
      </div>

      {/* Grade (≥ sm) */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {cabecalhos.map((r) => (
            <div key={r} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {r}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 divide-x divide-y">
          {grade.map((celula, i) => {
            if (!celula) return <div key={`vazio-${i}`} className="min-h-[112px] bg-muted/15" />;
            const doDia = porDia.get(celula.chave) ?? [];
            const excedente = doDia.length - POR_DIA_VISIVEIS;
            return (
              <div
                key={celula.chave}
                data-testid={`celula-${celula.chave}`}
                className={cn("flex min-h-[112px] flex-col gap-1 p-1.5", celula.chave === hoje && "bg-accent-soft/40", onNovaNoDia && "cursor-pointer transition-colors hover:bg-muted/30")}
                onClick={onNovaNoDia ? () => onNovaNoDia(celula.chave) : undefined}
              >
                <span className={cn("flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-semibold", celula.chave === hoje ? "bg-accent text-white" : "text-muted-foreground")}>
                  {celula.dia}
                </span>
                {doDia.slice(0, POR_DIA_VISIVEIS).map(chip)}
                {excedente > 0 ? (
                  <button
                    type="button"
                    className="pl-1 text-left text-[10px] font-semibold text-muted-foreground hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAbrir(doDia[POR_DIA_VISIVEIS]!);
                    }}
                  >
                    +{excedente} {t("mais")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista por dia (< sm) */}
      <div className="divide-y sm:hidden">
        {grade.filter((c): c is { dia: number; chave: string } => c !== null).map((celula) => {
          const doDia = porDia.get(celula.chave) ?? [];
          if (doDia.length === 0) return null;
          return (
            <div key={celula.chave} className="flex flex-col gap-1 px-3 py-2">
              <span className={cn("text-xs font-semibold capitalize", celula.chave === hoje ? "text-accent" : "text-muted-foreground")}>
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
