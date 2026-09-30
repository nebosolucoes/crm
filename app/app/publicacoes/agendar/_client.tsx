"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { FormularioDePublicacao } from "@/components/publicacoes/FormularioDePublicacao";
import { useT } from "@/hooks/i18n/useT";
import { useRascunhos } from "@/hooks/publicacoes/usePublicacoes";

/** Agendar: o formulário único, com a faixa de rascunhos para retomar. */
export function AgendarClient({ fuso, agoraIso }: { fuso: string; agoraIso: string }) {
  const t = useT();
  const params = useSearchParams();
  const editarId = params.get("editar");
  const diaSugerido = params.get("dia");
  const { data: rascunhos } = useRascunhos();

  return (
    <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{editarId ? t("Editar publicação") : t("Agendar publicação")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("Escolha os arquivos, escreva a legenda, marque onde sai e quando. O resto o sistema cuida.")}</p>
      </div>
      {!editarId && rascunhos && rascunhos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3 text-xs">
          <span className="font-medium">{t("Rascunhos")}:</span>
          {rascunhos.slice(0, 6).map((r) => (
            <Link key={r.id} href={`/app/publicacoes/agendar?editar=${r.id}`} className="rounded-full bg-muted px-2.5 py-1 hover:bg-muted/70">
              {r.title?.trim() || r.body?.slice(0, 30) || t("Sem título")}
            </Link>
          ))}
        </div>
      ) : null}
      <FormularioDePublicacao key={editarId ?? "nova"} fuso={fuso} editarId={editarId} diaSugerido={diaSugerido} agoraIso={agoraIso} />
    </div>
  );
}
