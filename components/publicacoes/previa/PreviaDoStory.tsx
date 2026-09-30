"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { DotsThree, Heart, PaperPlaneTilt, X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { Aparelho, AvatarDaConta, MidiaVisual, nomeDaConta, type ContaDaPrevia, type MidiaDaPrevia } from "./Aparelho";

interface Props {
  rede: "instagram" | "facebook";
  conta: ContaDaPrevia;
  midias: MidiaDaPrevia[];
  hora: string;
}

/**
 * Stories: tela cheia 9:16, uma barra de progresso por arquivo (cada arquivo
 * é UM Story), avatar + @ + "agora" no topo, e a barra "Enviar mensagem" com
 * o coração e o avião embaixo. Tocar na metade esquerda/direita troca o Story,
 * como no aparelho. Não há legenda: a rede não mostra.
 */
export function PreviaDoStory({ rede, conta, midias, hora }: Props) {
  const t = useT();
  const nome = nomeDaConta(conta, rede === "instagram" ? "sua.conta" : t("Sua Página"));
  const visuais = midias.filter((m) => m.kind === "image" || m.kind === "video");
  const [i, setI] = useState(0);
  const idx = Math.min(i, Math.max(0, visuais.length - 1));
  const atual = visuais[idx] ?? null;
  const rotulo = `${t("Prévia do Story")} · ${rede === "instagram" ? "Instagram" : "Facebook"}`;

  return (
    <Aparelho hora={hora} tema="escuro" rotulo={rotulo}>
      <div className="relative flex h-full flex-col bg-black text-white">
        <div className="absolute inset-0">
          <MidiaVisual midia={atual} className="h-full w-full" />
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />
        </div>
        {/* Barras de progresso: uma por Story */}
        <div className="relative z-10 flex gap-1 px-2 pt-1">
          {(visuais.length > 0 ? visuais : [{ id: "vazio" }]).map((m, k) => (
            <span key={m.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/45 shadow-[0_0_2px_rgba(0,0,0,0.5)]">
              <span className={cn("block h-full bg-white", k < idx ? "w-full" : k === idx ? "w-2/3" : "w-0")} />
            </span>
          ))}
        </div>
        <div className="relative z-10 flex items-center gap-2 px-3 pt-2">
          <AvatarDaConta nome={nome} url={conta.avatarUrl} tamanho={32} className="ring-2 ring-white/80" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold drop-shadow">
            {nome} <span className="font-normal text-white/80">{t("agora")}</span>
          </span>
          <DotsThree size={20} weight="bold" aria-hidden />
          <X size={20} aria-hidden />
        </div>
        {visuais.length > 1 ? (
          <>
            <button type="button" aria-label={t("Story anterior")} className="absolute inset-y-16 left-0 z-10 w-1/3" onClick={() => setI((x) => Math.max(0, x - 1))} />
            <button type="button" aria-label={t("Próximo Story")} className="absolute inset-y-16 right-0 z-10 w-1/3" onClick={() => setI((x) => Math.min(visuais.length - 1, x + 1))} />
          </>
        ) : null}
        {visuais.length === 0 ? <p className="relative z-10 mt-auto mb-auto px-6 text-center text-[13px] text-white/80">{t("Anexe uma foto ou um vídeo: cada arquivo vira um Story.")}</p> : null}
        <div className="relative z-10 mt-auto flex items-center gap-3 px-3 pb-6">
          <span className="flex h-10 flex-1 items-center rounded-full border border-white/60 px-4 text-[13px] text-white/85">{rede === "instagram" ? t("Enviar mensagem") : t("Responder…")}</span>
          <Heart size={24} aria-hidden />
          <PaperPlaneTilt size={24} aria-hidden />
        </div>
        {visuais.length > 1 ? (
          <span className="absolute right-3 bottom-[4.5rem] z-10 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white/90" aria-hidden>
            {idx + 1}/{visuais.length}
          </span>
        ) : null}
      </div>
    </Aparelho>
  );
}
