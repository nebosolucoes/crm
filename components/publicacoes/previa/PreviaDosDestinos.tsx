"use client";

import { useMemo, useState } from "react";

import { TelaDoWhatsApp, type AnexoDaPrevia } from "@/components/disparo/PreviaDoCelular";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import type { DestinoDaPublicacao } from "@/lib/publicacoes/schema";
import type { ContaPublicavel } from "@/lib/publicacoes/servico";
import { CaretLeft, CaretRight } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { PONTO_DA_REDE } from "../rotulos";
import { Aparelho, type MidiaDaPrevia } from "./Aparelho";
import { PreviaDoFeed } from "./PreviaDoFeed";
import { PreviaDoReel } from "./PreviaDoReel";
import { PreviaDoStory } from "./PreviaDoStory";
import { indiceValido, slidesDosDestinos } from "./slides";

interface Props {
  destinos: DestinoDaPublicacao[];
  contas: ContaPublicavel[];
  nomesDosGrupos: (ids: string[]) => string[];
  midias: MidiaDaPrevia[];
  legenda: string;
  hora: string;
  dataLegenda: string;
}

/**
 * Um aparelho por vez, um destino por slide: setas (e teclado) trocam de
 * rede/formato como quem passa Stories, e os pontos mostram quantos há. Cada
 * slide desenha a interface da rede com a conta escolhida (avatar e @) e as
 * marcas de cada formato — cabeçalho do Feed, barras do Story, botões do Reel,
 * a conversa do grupo no WhatsApp.
 */
export function PreviaDosDestinos({ destinos, contas, nomesDosGrupos, midias, legenda, hora, dataLegenda }: Props) {
  const t = useT();
  const slides = useMemo(() => slidesDosDestinos(destinos), [destinos]);
  const [estado, setEstado] = useState<{ indice: number; chave: string | null }>({ indice: 0, chave: null });
  const indice = indiceValido(estado.indice, slides, estado.chave);
  const slide = slides[indice] ?? null;
  const contaPorId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);

  const ir = (delta: number) => {
    if (slides.length === 0) return;
    const proximo = (indice + delta + slides.length) % slides.length;
    setEstado({ indice: proximo, chave: slides[proximo]?.chave ?? null });
  };

  if (!slide) {
    return <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">{t("Marque um destino para ver a prévia como ela vai aparecer.")}</div>;
  }

  const conta = contaPorId.get(slide.contaId);
  const contaDaPrevia = { username: conta?.username ?? null, displayName: conta?.display_name ?? null, avatarUrl: conta?.avatar_url ?? null };
  const anexosDoWhatsApp: AnexoDaPrevia[] = midias.map((m) => ({ id: m.id, kind: m.kind, url: m.url, nome: m.nome, mime: "", sizeBytes: 0 }));

  return (
    <div
      className="flex flex-col items-center gap-3"
      data-testid="previa-dos-destinos"
      role="region"
      aria-roledescription="carousel"
      aria-label={t("Prévia por destino")}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") ir(-1);
        if (e.key === "ArrowRight") ir(1);
      }}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Destino anterior")} onClick={() => ir(-1)} disabled={slides.length < 2} data-testid="previa-anterior">
          <CaretLeft size={18} aria-hidden />
        </Button>
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium" data-testid="previa-rotulo">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", PONTO_DA_REDE[slide.rede])} aria-hidden />
          <span className="truncate">{slide.rotulo}</span>
          <span className="text-xs text-muted-foreground">
            {indice + 1}/{slides.length}
          </span>
        </span>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Próximo destino")} onClick={() => ir(1)} disabled={slides.length < 2} data-testid="previa-proximo">
          <CaretRight size={18} aria-hidden />
        </Button>
      </div>

      <div key={slide.chave} data-testid={`previa-${slide.rede}-${slide.formato}`}>
        {slide.rede === "whatsapp" ? (
          <Aparelho hora={hora} rotulo={t("Prévia da mensagem como aparece no WhatsApp")} barra="#008069">
            <TelaDoWhatsApp grupos={nomesDosGrupos(slide.grupoIds)} mensagem={legenda} anexos={anexosDoWhatsApp} horario={hora} dataLegenda={dataLegenda} />
          </Aparelho>
        ) : slide.formato === "story" ? (
          <PreviaDoStory rede={slide.rede} conta={contaDaPrevia} midias={midias} hora={hora} />
        ) : slide.formato === "reel" ? (
          <PreviaDoReel rede={slide.rede} conta={contaDaPrevia} midias={midias} legenda={legenda} hora={hora} />
        ) : (
          <PreviaDoFeed rede={slide.rede} conta={contaDaPrevia} midias={midias} legenda={legenda} hora={hora} quando={dataLegenda} />
        )}
      </div>

      {slides.length > 1 ? (
        <div className="flex items-center gap-1.5" aria-hidden>
          {slides.map((s, k) => (
            <button key={s.chave} type="button" tabIndex={-1} onClick={() => setEstado({ indice: k, chave: s.chave })} className={cn("h-1.5 rounded-full transition-all", k === indice ? "w-5 bg-accent" : "w-1.5 bg-border")} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
