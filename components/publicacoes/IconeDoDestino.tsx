"use client";

import type { FormatoDaPublicacao, RedeDaPublicacao } from "@/lib/publicacoes/schema";
import { Circle, FacebookLogo, FilmStrip, ImageSquare, InstagramLogo, UsersThree, WhatsappLogo } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * O ícone de um destino: o logo da rede num círculo com a cor da marca dela e,
 * no canto, o glifo do formato (quadro = Feed, anel = Stories, filme = Reels,
 * pessoas = grupos). É a mesma peça no seletor de redes e em cada linha de
 * data/hora, para o olho ligar "marquei ali" a "sai aqui".
 *
 * As cores são as das marcas alheias, fixas de propósito (como nas prévias):
 * o que se imita é a rede, não o tema do produto. Apagado = cinza.
 */
export const COR_DA_REDE: Record<RedeDaPublicacao, string> = {
  instagram: "bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5]",
  facebook: "bg-[#1877f2]",
  whatsapp: "bg-[#25d366]",
};

const LOGO: Record<RedeDaPublicacao, typeof InstagramLogo> = {
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  whatsapp: WhatsappLogo,
};

const GLIFO: Record<FormatoDaPublicacao, typeof ImageSquare> = {
  feed: ImageSquare,
  story: Circle,
  reel: FilmStrip,
  group_message: UsersThree,
};

export function IconeDoDestino({
  rede,
  formato,
  ligado = true,
  tamanho = 36,
  className,
}: {
  rede: RedeDaPublicacao;
  formato: FormatoDaPublicacao;
  ligado?: boolean;
  tamanho?: number;
  className?: string;
}) {
  const Logo = LOGO[rede];
  const Glifo = GLIFO[formato];
  const selo = Math.round(tamanho * 0.42);
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full text-white transition-all", ligado ? COR_DA_REDE[rede] : "bg-muted text-muted-foreground", className)}
      style={{ width: tamanho, height: tamanho }}
      aria-hidden
    >
      <Logo size={Math.round(tamanho * 0.58)} weight="fill" />
      <span
        className={cn("absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full border-2 border-card", ligado ? "bg-foreground text-background" : "bg-muted-foreground/60 text-background")}
        style={{ width: selo, height: selo }}
      >
        <Glifo size={Math.max(8, Math.round(selo * 0.62))} weight={formato === "story" ? "bold" : "fill"} />
      </span>
    </span>
  );
}
