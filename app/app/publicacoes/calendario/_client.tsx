"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CabecalhoDePublicacoes } from "@/components/publicacoes/Cabecalho";
import { CalendarioDePublicacoes } from "@/components/publicacoes/CalendarioDePublicacoes";
import { DialogoDeCancelar, DialogoDeReagendar } from "@/components/publicacoes/DialogosDeOcorrencia";
import { SheetDaOcorrencia } from "@/components/publicacoes/SheetDaOcorrencia";
import { useT } from "@/hooks/i18n/useT";
import { useOcorrencias, useRealtimeDePublicacoes } from "@/hooks/publicacoes/usePublicacoes";
import { partesNoFuso } from "@/lib/agenda/fuso";
import { limitesDoMes } from "@/lib/publicacoes/tempo-da-tela";

/** Calendário: o mês, com um chip por ocorrência (pendente ou já saída). */
export function CalendarioClient({ podeEditar, fuso }: { podeEditar: boolean; fuso: string }) {
  const t = useT();
  const router = useRouter();
  const hoje = partesNoFuso(new Date(), fuso);
  const [ano, setAno] = useState(hoje.ano);
  const [mes, setMes] = useState(hoje.mes);
  const intervalo = useMemo(() => ({ ...limitesDoMes(ano, mes, fuso), incluir: "todas" as const }), [ano, mes, fuso]);
  const { data } = useOcorrencias(intervalo);
  useRealtimeDePublicacoes();

  const [aberta, setAberta] = useState<string | null>(null);
  const [reagendar, setReagendar] = useState<{ id: string; scheduledAt: string } | null>(null);
  const [cancelar, setCancelar] = useState<{ tipo: "ocorrencia"; id: string } | { tipo: "publicacao"; id: string } | { tipo: "excluir"; id: string } | null>(null);

  function mover(delta: number) {
    const alvo = new Date(Date.UTC(ano, mes - 1 + delta, 1));
    setAno(alvo.getUTCFullYear());
    setMes(alvo.getUTCMonth() + 1);
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <CabecalhoDePublicacoes titulo={t("Calendário")} descricao={t("O mês inteiro de uma vez: cada chip é uma publicação num horário, com as redes em que sai.")} podeEditar={podeEditar} />
      <CalendarioDePublicacoes
        ano={ano}
        mes={mes}
        ocorrencias={data}
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
