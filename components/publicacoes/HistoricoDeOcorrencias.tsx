"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useHistorico } from "@/hooks/publicacoes/usePublicacoes";
import type { RedeDaPublicacao, StatusDaOcorrencia } from "@/lib/publicacoes/schema";
import type { OcorrenciaResumida } from "@/lib/publicacoes/servico";
import { horaLocal } from "@/lib/publicacoes/tempo-da-tela";
import { ClockCounterClockwise } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { ChipsDeDestino } from "./ChipsDeDestino";
import { Miniatura } from "./Miniatura";
import { ROTULO_DA_REDE, ROTULO_DO_STATUS_DA_OCORRENCIA, VARIANTE_DO_STATUS_DA_OCORRENCIA } from "./rotulos";

/**
 * Só o que saiu do fluxo pendente: publicada, parcial, falhou, não saiu,
 * cancelada. Cada linha traz o placar por destino ("Instagram ✓ · Facebook ✗
 * · WhatsApp 3/4"); o clique abre o Sheet com cada execução e o erro.
 */
export function HistoricoDeOcorrencias({ fuso, selecionadaId, onAbrir }: { fuso: string; selecionadaId: string | null; onAbrir: (o: OcorrenciaResumida) => void }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [status, setStatus] = useState<"todas" | StatusDaOcorrencia>("todas");
  const [rede, setRede] = useState<"todas" | RedeDaPublicacao>("todas");
  const [cursores, setCursores] = useState<string[]>([]);
  const cursor = cursores[cursores.length - 1];
  const { data, isLoading } = useHistorico({ status: status === "todas" ? undefined : status, network: rede === "todas" ? undefined : rede, cursor, limit: 50 });
  const formatador = useMemo(() => new Intl.DateTimeFormat(tag, { weekday: "short", day: "2-digit", month: "short", timeZone: fuso }), [tag, fuso]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as typeof status);
            setCursores([]);
          }}
        >
          <SelectTrigger className="h-9 w-[170px] text-xs" aria-label={t("Filtrar por situação")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">{t("Todas as situações")}</SelectItem>
            <SelectItem value="done">{t("Publicada")}</SelectItem>
            <SelectItem value="partial">{t("Parcial")}</SelectItem>
            <SelectItem value="failed">{t("Falhou")}</SelectItem>
            <SelectItem value="skipped">{t("Não saiu")}</SelectItem>
            <SelectItem value="cancelled">{t("Cancelada")}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={rede}
          onValueChange={(v) => {
            setRede(v as typeof rede);
            setCursores([]);
          }}
        >
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label={t("Filtrar por rede")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">{t("Todas as redes")}</SelectItem>
            {(Object.keys(ROTULO_DA_REDE) as RedeDaPublicacao[]).map((r) => (
              <SelectItem key={r} value={r}>
                {ROTULO_DA_REDE[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && !data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : !data || data.itens.length === 0 ? (
        <EmptyState icon={ClockCounterClockwise} headline={t("Nada aqui ainda")} subcopy={t("Quando uma publicação sair (ou falhar), o desfecho por destino aparece aqui.")} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="historico-lista">
          {data.itens.map((o) => {
            const ex = o.executions;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onAbrir(o)}
                  data-testid={`historico-${o.id}`}
                  className={cn("flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/30", selecionadaId === o.id && "ring-2 ring-accent-500")}
                >
                  <Miniatura storagePath={o.thumb?.storage_path ?? null} kind={o.thumb?.kind ?? null} className="h-12 w-12" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{o.title?.trim() || t("Publicação sem título")}</span>
                      <Badge variant={VARIANTE_DO_STATUS_DA_OCORRENCIA[o.status]}>{t(ROTULO_DO_STATUS_DA_OCORRENCIA[o.status])}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="capitalize">
                        {formatador.format(new Date(o.scheduled_at))} · {horaLocal(o.scheduled_at, fuso)}
                      </span>
                      {ex.total > 0 ? (
                        <span>
                          {ex.sent}/{ex.total} {t("publicados")}
                          {ex.failed > 0 ? ` · ${ex.failed} ${t("falhas")}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <ChipsDeDestino targets={o.targets} compacto className="mt-1.5" />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {data && (data.has_more || cursores.length > 0) ? (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={cursores.length === 0} onClick={() => setCursores((c) => c.slice(0, -1))}>
            {t("Mais recentes")}
          </Button>
          <Button variant="outline" size="sm" disabled={!data.has_more || !data.cursor} onClick={() => data.cursor && setCursores((c) => [...c, data.cursor!])}>
            {t("Mais antigas")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
