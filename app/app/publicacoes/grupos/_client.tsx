"use client";

import { CabecalhoDePublicacoes } from "@/components/publicacoes/Cabecalho";
import { GruposDeWhatsApp } from "@/components/publicacoes/GruposDeWhatsApp";
import { useT } from "@/hooks/i18n/useT";

/** Grupos: os grupos de WhatsApp que podem receber publicações. */
export function GruposClient({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <CabecalhoDePublicacoes titulo={t("Grupos")} descricao={t("Os grupos de WhatsApp que podem receber publicações. Busque os grupos de cada conexão e desative os que não devem receber.")} podeEditar={podeEditar} />
      <GruposDeWhatsApp podeEditar={podeEditar} />
    </div>
  );
}
