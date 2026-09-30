"use client";

import { useMemo } from "react";

import { EmptyState } from "@/components/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type { OcorrenciaResumida } from "@/lib/publicacoes/servico";
import { agruparPorDia, rotuloDoDia } from "@/lib/publicacoes/tempo-da-tela";
import { CalendarDots } from "@/lib/ui/icons";

import { CartaoDeOcorrencia } from "./CartaoDeOcorrencia";
import { MenuDeAcoes } from "./MenuDeAcoes";

/**
 * SÓ o que ainda vai sair, do mais próximo ao mais distante, agrupado por dia
 * (Hoje, Amanhã, depois a data). O que já saiu mora no Histórico.
 */
export function ListaDePendentes({
  ocorrencias,
  carregando,
  fuso,
  agoraIso,
  podeEditar,
  selecionadaId,
  onAbrir,
  onAlterarHorario,
  onCancelarOcorrencia,
  onCancelarPublicacao,
  onExcluir,
}: {
  ocorrencias: OcorrenciaResumida[] | undefined;
  carregando: boolean;
  fuso: string;
  /** O instante de referência de "Hoje"/"Amanhã", vindo do servidor (puro no render). */
  agoraIso: string;
  podeEditar: boolean;
  selecionadaId: string | null;
  onAbrir: (o: OcorrenciaResumida) => void;
  onAlterarHorario: (o: OcorrenciaResumida) => void;
  onCancelarOcorrencia: (o: OcorrenciaResumida) => void;
  onCancelarPublicacao: (o: OcorrenciaResumida) => void;
  onExcluir: (o: OcorrenciaResumida) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const agora = useMemo(() => new Date(agoraIso), [agoraIso]);

  const ordenadas = useMemo(() => [...(ocorrencias ?? [])].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)), [ocorrencias]);
  const posicoes = useMemo(() => {
    const porPub = new Map<string, string[]>();
    for (const o of ordenadas) {
      const lista = porPub.get(o.publication_id) ?? [];
      lista.push(o.id);
      porPub.set(o.publication_id, lista);
    }
    const saida = new Map<string, { indice: number; total: number }>();
    for (const ids of porPub.values()) ids.forEach((id, i) => saida.set(id, { indice: i + 1, total: ids.length }));
    return saida;
  }, [ordenadas]);
  const grupos = useMemo(() => agruparPorDia(ordenadas, (o) => o.scheduled_at, fuso), [ordenadas, fuso]);
  const formatador = useMemo(() => new Intl.DateTimeFormat(tag, { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }), [tag]);

  if (carregando && !ocorrencias) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (ordenadas.length === 0) {
    return (
      <EmptyState
        icon={CalendarDots}
        headline={t("Nada agendado por enquanto")}
        subcopy={t("Crie uma publicação, escolha onde ela sai e quando. Ela aparece aqui até o horário chegar.")}
        primary={podeEditar ? { label: t("Agendar publicação"), href: "/app/publicacoes/agendar" } : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {grupos.map(({ dia, itens }) => {
        const r = rotuloDoDia(itens[0]!.scheduled_at, agora, fuso);
        const rotulo = r.tipo === "hoje" ? t("Hoje") : r.tipo === "amanha" ? t("Amanhã") : r.tipo === "ontem" ? t("Ontem") : formatador.format(r.data);
        return (
          <section key={dia} aria-label={rotulo} className="flex flex-col gap-2">
            <h2 className="flex items-baseline gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className={r.tipo === "hoje" ? "text-accent" : undefined}>{rotulo}</span>
              <span className="font-normal normal-case tracking-normal">
                {itens.length} {itens.length === 1 ? t("publicação") : t("publicações")}
              </span>
            </h2>
            {itens.map((o) => (
              <CartaoDeOcorrencia
                key={o.id}
                ocorrencia={o}
                posicao={posicoes.get(o.id) ?? null}
                fuso={fuso}
                selecionada={selecionadaId === o.id}
                onAbrir={() => onAbrir(o)}
                acoes={
                  podeEditar ? (
                    <MenuDeAcoes
                      publicacaoId={o.publication_id}
                      pendente={o.status === "pending"}
                      onAlterarHorario={() => onAlterarHorario(o)}
                      onCancelarOcorrencia={() => onCancelarOcorrencia(o)}
                      onCancelarPublicacao={() => onCancelarPublicacao(o)}
                      onExcluir={() => onExcluir(o)}
                    />
                  ) : null
                }
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
