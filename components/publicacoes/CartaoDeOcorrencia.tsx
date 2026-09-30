"use client";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";
import type { OcorrenciaResumida } from "@/lib/publicacoes/servico";
import { horaLocal } from "@/lib/publicacoes/tempo-da-tela";
import { descreverRecorrencia } from "@/lib/publicacoes/recorrencia";
import { ArrowsClockwise, ImageSquare } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { ChipsDeDestino } from "./ChipsDeDestino";
import { Miniatura } from "./Miniatura";
import { ROTULO_DO_STATUS_DA_OCORRENCIA, VARIANTE_DO_STATUS_DA_OCORRENCIA } from "./rotulos";

/**
 * Uma linha da Lista: hora, miniatura, título, resumo da legenda, destinos e
 * o placar. Uma linha = UMA ocorrência; a mesma publicação em quatro datas são
 * quatro linhas, e o "2 de 4" diz isso.
 */
export function CartaoDeOcorrencia({
  ocorrencia,
  posicao,
  fuso,
  selecionada,
  onAbrir,
  acoes,
}: {
  ocorrencia: OcorrenciaResumida;
  /** "2 de 4" quando a publicação tem várias datas pendentes. */
  posicao?: { indice: number; total: number } | null;
  fuso: string;
  selecionada?: boolean;
  onAbrir: () => void;
  acoes?: React.ReactNode;
}) {
  const t = useT();
  const resumo = (ocorrencia.body ?? "").replace(/\s+/g, " ").trim();
  const recorrencia = descreverRecorrencia(ocorrencia.recurrence_kind, ocorrencia.recurrence_config as never);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      data-testid={`ocorrencia-${ocorrencia.id}`}
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/30 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500",
        selecionada && "ring-2 ring-accent-500",
      )}
    >
      <div className="flex w-12 shrink-0 flex-col items-center pt-0.5">
        <span className="text-sm font-semibold tabular-nums">{horaLocal(ocorrencia.scheduled_at, fuso)}</span>
        {recorrencia ? (
          <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={t(recorrencia)}>
            <ArrowsClockwise size={11} aria-hidden />
          </span>
        ) : null}
      </div>
      <Miniatura storagePath={ocorrencia.thumb?.storage_path ?? null} kind={ocorrencia.thumb?.kind ?? null} className="h-14 w-14" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold">{ocorrencia.title?.trim() || t("Publicação sem título")}</span>
          {posicao && posicao.total > 1 ? (
            <span className="text-xs text-muted-foreground">
              {posicao.indice} {t("de")} {posicao.total}
            </span>
          ) : null}
          <Badge variant={VARIANTE_DO_STATUS_DA_OCORRENCIA[ocorrencia.status]}>{t(ROTULO_DO_STATUS_DA_OCORRENCIA[ocorrencia.status])}</Badge>
        </div>
        {resumo ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{resumo}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ChipsDeDestino targets={ocorrencia.targets} />
          {ocorrencia.media_count > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <ImageSquare size={12} aria-hidden />
              {ocorrencia.media_count}
            </span>
          ) : null}
        </div>
      </div>
      {acoes ? (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {acoes}
        </div>
      ) : null}
    </div>
  );
}
