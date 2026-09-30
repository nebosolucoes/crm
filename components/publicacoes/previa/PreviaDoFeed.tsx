"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { BookmarkSimple, ChatCircle, DotsThree, Globe, Heart, PaperPlaneTilt, ShareFat, ThumbsUp } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { Aparelho, AvatarDaConta, MidiaVisual, nomeDaConta, type ContaDaPrevia, type MidiaDaPrevia } from "./Aparelho";

interface Props {
  rede: "instagram" | "facebook";
  conta: ContaDaPrevia;
  midias: MidiaDaPrevia[];
  legenda: string;
  hora: string;
  /** "há 2 h", "30 de set" — como a rede mostra a idade do post. */
  quando: string;
}

/**
 * Feed: no Instagram, cabeçalho com avatar e @, a foto (carrossel com "1/N"
 * e os pontos), coração/comentário/enviar/salvar, curtidas e a legenda
 * começando pelo @. No Facebook, o nome da Página, a hora com o globo, o
 * texto ACIMA da mídia, a grade de fotos e a barra Curtir/Comentar/Compartilhar.
 */
export function PreviaDoFeed({ rede, conta, midias, legenda, hora, quando }: Props) {
  const t = useT();
  const nome = nomeDaConta(conta, rede === "instagram" ? "sua.conta" : t("Sua Página"));
  const visuais = midias.filter((m) => m.kind === "image" || m.kind === "video");
  const [i, setI] = useState(0);
  const atual = visuais[Math.min(i, Math.max(0, visuais.length - 1))] ?? null;
  const rotulo = `${t("Prévia do post no Feed")} · ${rede === "instagram" ? "Instagram" : "Facebook"}`;

  if (rede === "instagram") {
    return (
      <Aparelho hora={hora} rotulo={rotulo}>
        <div className="flex h-full flex-col bg-white text-[#262626]">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[20px] font-semibold tracking-tight" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
              Instagram
            </span>
            <span className="flex items-center gap-4" aria-hidden>
              <Heart size={22} />
              <PaperPlaneTilt size={22} />
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 pb-2">
            <span className="rounded-full bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[2px]">
              <AvatarDaConta nome={nome} url={conta.avatarUrl} tamanho={30} className="ring-2 ring-white" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{nome}</span>
            <DotsThree size={20} weight="bold" aria-hidden />
          </div>
          <div className="relative aspect-[4/5] w-full bg-[#111]">
            <MidiaVisual midia={atual} className="h-full w-full" poster />
            {visuais.length > 1 ? (
              <>
                <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
                  {i + 1}/{visuais.length}
                </span>
                <button type="button" aria-label={t("Foto anterior")} className="absolute inset-y-0 left-0 w-1/3" onClick={() => setI((x) => Math.max(0, x - 1))} />
                <button type="button" aria-label={t("Próxima foto")} className="absolute inset-y-0 right-0 w-1/3" onClick={() => setI((x) => Math.min(visuais.length - 1, x + 1))} />
              </>
            ) : null}
          </div>
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="flex items-center gap-4" aria-hidden>
              <Heart size={24} />
              <ChatCircle size={24} />
              <PaperPlaneTilt size={24} />
            </span>
            {visuais.length > 1 ? (
              <span className="flex items-center gap-1" aria-hidden>
                {visuais.map((m, k) => (
                  <span key={m.id} className={cn("h-1.5 w-1.5 rounded-full", k === i ? "bg-[#0095f6]" : "bg-[#dbdbdb]")} />
                ))}
              </span>
            ) : null}
            <BookmarkSimple size={24} aria-hidden />
          </div>
          <div className="px-3 pt-2 text-[13px] leading-[17px]">
            <p className="font-semibold">{t("Curtido por")} <span className="font-semibold">{t("outras pessoas")}</span></p>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap">
              <span className="font-semibold">{nome}</span> {legenda.trim() || <span className="text-[#8e8e8e]">{t("(sem legenda)")}</span>}
            </p>
            <p className="mt-1 text-[11px] uppercase text-[#8e8e8e]">{quando}</p>
          </div>
        </div>
      </Aparelho>
    );
  }

  const grade = visuais.slice(0, 4);
  const excedente = visuais.length - 4;
  return (
    <Aparelho hora={hora} rotulo={rotulo}>
      <div className="flex h-full flex-col bg-[#f0f2f5] text-[#050505]">
        <div className="flex items-center justify-between bg-white px-3 py-2">
          <span className="text-[22px] font-bold tracking-tight text-[#1877f2]">facebook</span>
          <span className="flex gap-2" aria-hidden>
            <span className="h-8 w-8 rounded-full bg-[#e4e6eb]" />
            <span className="h-8 w-8 rounded-full bg-[#e4e6eb]" />
          </span>
        </div>
        <div className="mt-2 bg-white">
          <div className="flex items-center gap-2 px-3 pt-3">
            <AvatarDaConta nome={nome} url={conta.avatarUrl} tamanho={38} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{nome}</span>
              <span className="flex items-center gap-1 text-[12px] text-[#65676b]">
                {quando} · <Globe size={12} aria-hidden />
              </span>
            </span>
            <DotsThree size={22} weight="bold" aria-hidden />
          </div>
          {legenda.trim() ? <p className="px-3 pt-2 pb-2 text-[14px] leading-[19px] whitespace-pre-wrap line-clamp-4">{legenda}</p> : <div className="h-2" />}
          {grade.length === 1 ? (
            <div className="relative aspect-[4/5] w-full bg-[#111]">
              <MidiaVisual midia={grade[0]!} className="h-full w-full" poster />
            </div>
          ) : grade.length > 1 ? (
            <div className={cn("grid gap-[2px] bg-white", grade.length === 2 ? "grid-cols-2" : "grid-cols-2")}>
              {grade.map((m, k) => (
                <div key={m.id} className={cn("relative bg-[#111]", grade.length === 3 && k === 0 ? "col-span-2 aspect-[16/9]" : "aspect-square")}>
                  <MidiaVisual midia={m} className="h-full w-full" poster />
                  {k === 3 && excedente > 0 ? <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[22px] font-semibold text-white">+{excedente}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between px-3 py-2 text-[12px] text-[#65676b]">
            <span className="flex items-center gap-1">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1877f2] text-white">
                <ThumbsUp size={9} weight="fill" aria-hidden />
              </span>
              {t("Você e outras pessoas")}
            </span>
          </div>
          <div className="mx-3 flex items-center justify-around border-t border-[#ced0d4] py-1.5 text-[13px] font-semibold text-[#65676b]">
            <span className="flex items-center gap-1.5">
              <ThumbsUp size={18} aria-hidden /> {t("Curtir")}
            </span>
            <span className="flex items-center gap-1.5">
              <ChatCircle size={18} aria-hidden /> {t("Comentar")}
            </span>
            <span className="flex items-center gap-1.5">
              <ShareFat size={18} aria-hidden /> {t("Compartilhar")}
            </span>
          </div>
        </div>
      </div>
    </Aparelho>
  );
}
