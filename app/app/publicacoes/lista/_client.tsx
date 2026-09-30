"use client";

import { useMemo, useState } from "react";

import { CabecalhoDePublicacoes } from "@/components/publicacoes/Cabecalho";
import { DialogoDeCancelar, DialogoDeReagendar } from "@/components/publicacoes/DialogosDeOcorrencia";
import { ListaDePendentes } from "@/components/publicacoes/ListaDePendentes";
import { SheetDaOcorrencia } from "@/components/publicacoes/SheetDaOcorrencia";
import { useT } from "@/hooks/i18n/useT";
import { useOcorrencias, useRealtimeDePublicacoes } from "@/hooks/publicacoes/usePublicacoes";
import type { OcorrenciaResumida } from "@/lib/publicacoes/servico";

const UM_DIA = 24 * 60 * 60 * 1000;

/** Lista: só o pendente, do mais próximo ao mais distante, por dia. */
export function ListaClient({ podeEditar, fuso, agoraIso }: { podeEditar: boolean; fuso: string; agoraIso: string }) {
  const t = useT();
  const intervalo = useMemo(() => {
    const agora = new Date(agoraIso).getTime();
    return { de: new Date(agora - UM_DIA).toISOString(), ate: new Date(agora + 366 * UM_DIA).toISOString(), incluir: "pendentes" as const };
  }, [agoraIso]);
  const { data, isLoading } = useOcorrencias(intervalo);
  useRealtimeDePublicacoes();

  const [aberta, setAberta] = useState<string | null>(null);
  const [reagendar, setReagendar] = useState<{ id: string; scheduledAt: string } | null>(null);
  const [cancelar, setCancelar] = useState<{ tipo: "ocorrencia"; id: string } | { tipo: "publicacao"; id: string } | { tipo: "excluir"; id: string } | null>(null);

  const abrir = (o: OcorrenciaResumida) => setAberta(o.id);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <CabecalhoDePublicacoes titulo={t("Publicações")} descricao={t("O que ainda vai sair, do mais próximo ao mais distante. O que já saiu está no Histórico.")} podeEditar={podeEditar} />
      <ListaDePendentes
        ocorrencias={data}
        carregando={isLoading}
        fuso={fuso}
        agoraIso={agoraIso}
        podeEditar={podeEditar}
        selecionadaId={aberta}
        onAbrir={abrir}
        onAlterarHorario={(o) => setReagendar({ id: o.id, scheduledAt: o.scheduled_at })}
        onCancelarOcorrencia={(o) => setCancelar({ tipo: "ocorrencia", id: o.id })}
        onCancelarPublicacao={(o) => setCancelar({ tipo: "publicacao", id: o.publication_id })}
        onExcluir={(o) => setCancelar({ tipo: "excluir", id: o.publication_id })}
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
