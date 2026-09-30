"use client";

import { useT } from "@/hooks/i18n/useT";
import type { ResumoDeDestino } from "@/lib/publicacoes/servico";
import { cn } from "@/lib/utils";

import { PONTO_DA_REDE, ROTULO_DA_REDE, ROTULO_DO_FORMATO } from "./rotulos";

/** Um chip por destino: ponto da rede, formato e, no WhatsApp, quantos grupos. */
export function ChipsDeDestino({ targets, compacto = false, className }: { targets: ResumoDeDestino[]; compacto?: boolean; className?: string }) {
  const t = useT();
  if (targets.length === 0) return <span className="text-xs text-muted-foreground">{t("Sem destino")}</span>;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {targets.map((d) => (
        <span
          key={d.id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text-muted",
            d.removido && "line-through opacity-60",
          )}
          title={`${ROTULO_DA_REDE[d.network]} · ${t(ROTULO_DO_FORMATO[d.format])}${d.display_name ? ` · ${d.display_name}` : ""}`}
        >
          <span className={cn("h-2 w-2 rounded-full", PONTO_DA_REDE[d.network])} aria-hidden />
          {compacto ? null : <span>{ROTULO_DA_REDE[d.network]}</span>}
          <span className={compacto ? "" : ""}>
            {d.network === "whatsapp" ? `${d.group_count} ${d.group_count === 1 ? t("grupo") : t("grupos")}` : t(ROTULO_DO_FORMATO[d.format])}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Só os pontos das redes presentes (para o chip do calendário). */
export function PontosDasRedes({ targets }: { targets: ResumoDeDestino[] }) {
  const redes = [...new Set(targets.map((d) => d.network))];
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {redes.map((r) => (
        <span key={r} className={cn("h-1.5 w-1.5 rounded-full", PONTO_DA_REDE[r])} />
      ))}
    </span>
  );
}
