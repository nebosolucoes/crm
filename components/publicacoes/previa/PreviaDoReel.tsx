"use client";

import { useT } from "@/hooks/i18n/useT";
import { ChatCircle, DotsThree, Heart, MusicNote, PaperPlaneTilt, ShareFat, ThumbsUp } from "@/lib/ui/icons";

import { Aparelho, AvatarDaConta, MidiaVisual, nomeDaConta, type ContaDaPrevia, type MidiaDaPrevia } from "./Aparelho";

interface Props {
  rede: "instagram" | "facebook";
  conta: ContaDaPrevia;
  midias: MidiaDaPrevia[];
  legenda: string;
  hora: string;
}

/**
 * Reels: vídeo em tela cheia 9:16, os botões à direita (coração, comentário,
 * enviar, mais), e embaixo o @ com "Seguir", a legenda e a faixa do áudio.
 * No Facebook, a mesma coreografia com o polegar no lugar do coração. O
 * vídeo aparece inteiro: um horizontal ganha faixas, como na rede.
 */
export function PreviaDoReel({ rede, conta, midias, legenda, hora }: Props) {
  const t = useT();
  const nome = nomeDaConta(conta, rede === "instagram" ? "sua.conta" : t("Sua Página"), rede);
  const video = midias.find((m) => m.kind === "video") ?? midias.find((m) => m.kind === "image") ?? null;
  const rotulo = `${t("Prévia do Reel")} · ${rede === "instagram" ? "Instagram" : "Facebook"}`;
  const Curtir = rede === "instagram" ? Heart : ThumbsUp;

  return (
    <Aparelho hora={hora} tema="escuro" rotulo={rotulo}>
      <div className="relative flex h-full flex-col bg-black text-white">
        <div className="absolute inset-0">
          <MidiaVisual midia={video} className="h-full w-full" ajuste="conter" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/75 to-transparent" aria-hidden />
        </div>
        <div className="relative z-10 flex items-center justify-between px-4 pt-2 text-[16px] font-semibold drop-shadow">
          <span>Reels</span>
          <span className="h-5 w-5 rounded-md border-2 border-white/90" aria-hidden />
        </div>
        {!video ? <p className="relative z-10 mt-auto mb-auto px-8 text-center text-[13px] text-white/80">{t("Anexe um vídeo vertical para ver o Reel.")}</p> : null}
        <div className="relative z-10 mt-auto flex items-end gap-3 px-3 pb-8">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <AvatarDaConta nome={nome} url={conta.avatarUrl} tamanho={30} className="ring-1 ring-white/80" />
              <span className="truncate text-[13px] font-semibold drop-shadow">{nome}</span>
              <span className="rounded-md border border-white/80 px-2 py-0.5 text-[11px] font-semibold">{t("Seguir")}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] leading-[17px] drop-shadow">{legenda.trim() || <span className="text-white/60">{t("(sem legenda)")}</span>}</p>
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-white/90">
              <MusicNote size={12} aria-hidden />
              <span className="truncate">
                {nome} · {t("Áudio original")}
              </span>
            </p>
          </div>
          <div className="flex flex-col items-center gap-4 pb-1 text-[11px]" aria-hidden>
            <span className="flex flex-col items-center gap-0.5">
              <Curtir size={26} />
              <span>12,3 mil</span>
            </span>
            <span className="flex flex-col items-center gap-0.5">
              <ChatCircle size={26} />
              <span>184</span>
            </span>
            <span className="flex flex-col items-center gap-0.5">{rede === "instagram" ? <PaperPlaneTilt size={26} /> : <ShareFat size={26} />}</span>
            <DotsThree size={26} weight="bold" />
            <span className="h-7 w-7 rounded-md border-2 border-white/80 bg-[#333]" />
          </div>
        </div>
      </div>
    </Aparelho>
  );
}
