"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { CabecalhoDePublicacoes } from "@/components/publicacoes/Cabecalho";
import { HistoricoDeOcorrencias } from "@/components/publicacoes/HistoricoDeOcorrencias";
import { SheetDaOcorrencia } from "@/components/publicacoes/SheetDaOcorrencia";
import { useT } from "@/hooks/i18n/useT";
import { useRealtimeDePublicacoes } from "@/hooks/publicacoes/usePublicacoes";

/** Histórico: o que saiu do pendente, com o desfecho por destino. `?ocorrencia=` abre o painel (é o link da Central). */
export function HistoricoClient({ podeEditar, fuso }: { podeEditar: boolean; fuso: string }) {
  const t = useT();
  const params = useSearchParams();
  // `?ocorrencia=` (o link da Central) abre o painel já na primeira renderização.
  const [aberta, setAberta] = useState<string | null>(() => params.get("ocorrencia"));
  useRealtimeDePublicacoes();

  return (
    <div className="flex h-full flex-col gap-6 p-6 pt-0">
      <CabecalhoDePublicacoes titulo={t("Histórico")} descricao={t("Tudo que já saiu ou deixou de sair, com o resultado em cada destino, conta e grupo — e o motivo quando falhou.")} podeEditar={podeEditar} />
      <HistoricoDeOcorrencias fuso={fuso} selecionadaId={aberta} onAbrir={(o) => setAberta(o.id)} />
      <SheetDaOcorrencia ocorrenciaId={aberta} fuso={fuso} podeEditar={podeEditar} onFechar={() => setAberta(null)} />
    </div>
  );
}
