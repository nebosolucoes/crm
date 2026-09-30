"use client";

import { useId } from "react";
import { siFacebook, siInstagram, siWhatsapp } from "simple-icons";

import type { FormatoDaPublicacao, RedeDaPublicacao } from "@/lib/publicacoes/schema";
import { cn } from "@/lib/utils";

/**
 * `<ChannelIcon channel format state size />` — o ícone de um destino de
 * publicação, com um TRATAMENTO por formato para ninguém confundir Feed com
 * Stories com Reels na mesma rede:
 *
 *  - Feed: círculo CHEIO na cor da marca, logo branco no centro;
 *  - Stories / Status: círculo VAZADO com um ANEL SEGMENTADO em volta (oito
 *    traços, o "cortadinho" que a própria rede usa), logo na cor da marca;
 *  - Reels: círculo cheio com o glifo de VÍDEO (claquete + play) no lugar do
 *    logo e um selo com o logo da rede no canto, para Instagram e Facebook
 *    Reels continuarem distintos quando o ícone está cinza.
 *
 * Tudo é circular (viewBox 0 0 40 40) e o glifo ocupa ~50% do diâmetro.
 * Estados: `active` (cores da marca), `inactive` (tudo em #C4C4C4) e
 * `disabled` (inactive + opacidade 0,5 + cursor proibido). O hover dá um
 * leve `scale(1.05)` em 150 ms.
 *
 * Logos: glifos da biblioteca **simple-icons** (licença CC0 1.0 —
 * https://github.com/simple-icons/simple-icons), nunca desenhados à mão. A
 * claquete do Reels é forma simples desenhada aqui. Os gradientes recebem um
 * id por instância (`useId`), então vários ícones na mesma tela não colidem.
 *
 * Para adicionar uma rede (TikTok, YouTube Shorts…): uma entrada em
 * `CHANNEL_CONFIG` com o glifo do simple-icons, a pintura e os formatos que
 * ela publica. O tratamento de cada formato vem de `FORMAT_TREATMENT`.
 *
 * O `xmlns` do SVG fica fora daqui de propósito: inline no HTML ele não é
 * necessário, e a cerca de hosts de terceiro (`tests/unit/branding.test.ts`)
 * o leria como endereço embarcado. Quem exporta arquivo `.svg`
 * (`scripts/exportar-icones-de-canal.ts`) o acrescenta na hora.
 */
export type Channel = "instagram" | "facebook" | "whatsapp";
export type ChannelFormat = "feed" | "stories" | "reels" | "status";
export type ChannelIconState = "active" | "inactive" | "disabled";
export type Treatment = "filled" | "ring" | "reels";

export type Paint = { kind: "solid"; color: string } | { kind: "gradient"; stops: string[] };

export interface ChannelConfig {
  /** Como a marca se chama, para o rótulo. */
  name: string;
  /** Glifo do simple-icons: path num viewBox 0 0 24 24. */
  glyph: { path: string; viewBox: 24 };
  /** A cor (ou gradiente) da marca no estado ativo. */
  paint: Paint;
  /** Os formatos que esta rede publica e o nome completo de cada um. */
  formats: Partial<Record<ChannelFormat, string>>;
}

export const CHANNEL_CONFIG: Record<Channel, ChannelConfig> = {
  instagram: {
    name: "Instagram",
    glyph: { path: siInstagram.path, viewBox: 24 },
    // Diagonal inferior esquerda → superior direita, as cinco paradas do gradiente da marca.
    paint: { kind: "gradient", stops: ["#FEDA75", "#FA7E1E", "#D62976", "#962FBF", "#4F5BD5"] },
    formats: { feed: "Instagram Feed", stories: "Instagram Stories", reels: "Instagram Reels" },
  },
  facebook: {
    name: "Facebook",
    glyph: { path: siFacebook.path, viewBox: 24 },
    paint: { kind: "solid", color: "#1877F2" },
    formats: { feed: "Facebook Feed", stories: "Facebook Stories", reels: "Facebook Reels" },
  },
  whatsapp: {
    name: "WhatsApp",
    glyph: { path: siWhatsapp.path, viewBox: 24 },
    paint: { kind: "solid", color: "#25D366" },
    // No WhatsApp, `feed` é a mensagem comum (nos grupos) e `status` é o Status.
    formats: { feed: "WhatsApp", status: "WhatsApp Status" },
  },
};

/** Que desenho cada formato recebe. Status é Stories com outro nome. */
export const FORMAT_TREATMENT: Record<ChannelFormat, Treatment> = {
  feed: "filled",
  stories: "ring",
  reels: "reels",
  status: "ring",
};

export const CHANNEL_ICON_STATES: readonly ChannelIconState[] = ["active", "inactive", "disabled"];

/** As combinações que existem hoje (8), na ordem em que a tela as mostra. */
export const CHANNEL_ICON_COMBINATIONS: ReadonlyArray<{ channel: Channel; format: ChannelFormat; name: string }> = (
  Object.keys(CHANNEL_CONFIG) as Channel[]
).flatMap((channel) =>
  (Object.entries(CHANNEL_CONFIG[channel].formats) as Array<[ChannelFormat, string]>).map(([format, name]) => ({ channel, format, name })),
);

/** O formato do domínio (`publication_targets.format`) no vocabulário do ícone. */
export function formatoParaChannelFormat(formato: FormatoDaPublicacao): ChannelFormat {
  switch (formato) {
    case "story":
      return "stories";
    case "reel":
      return "reels";
    case "feed":
    case "group_message":
    default:
      return "feed";
  }
}

/** A rede do domínio é o mesmo vocabulário do ícone — a função existe para o tipo dizer isso. */
export function redeParaChannel(rede: RedeDaPublicacao): Channel {
  return rede;
}

export const INACTIVE_COLOR = "#C4C4C4";
const GLYPH_SIZE = 20; // ~50% do diâmetro de 40
const RING_RADIUS = 18;
const RING_SEGMENTS = 8;
const RING_GAP = 4;
const RING_DASH = (2 * Math.PI * RING_RADIUS) / RING_SEGMENTS - RING_GAP; // ≈ 10,14
const BADGE_RADIUS = 7; // ≈ 35% de 40
const BADGE_GLYPH = 8;

export interface ChannelIconProps {
  channel: Channel;
  format: ChannelFormat;
  state?: ChannelIconState;
  /** Em px. O viewBox é sempre 0 0 40 40. */
  size?: number;
  /** Rótulo acessível; o padrão é o nome completo ("Instagram Stories"). */
  label?: string;
  /** Dentro de um botão que já tem rótulo, esconde o ícone do leitor de tela. */
  decorative?: boolean;
  className?: string;
}

export function ChannelIcon({ channel, format, state = "active", size = 36, label, decorative = false, className }: ChannelIconProps) {
  const config = CHANNEL_CONFIG[channel];
  const treatment = FORMAT_TREATMENT[format];
  const name = label ?? config.formats[format] ?? `${config.name} ${format}`;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `channel-icon-${uid}`;
  const active = state === "active";
  const paint: Paint = active ? config.paint : { kind: "solid", color: INACTIVE_COLOR };
  const fill = paint.kind === "gradient" ? `url(#${gradientId})` : paint.color;
  const glyphScale = GLYPH_SIZE / config.glyph.viewBox;
  const glyphOffset = (40 - GLYPH_SIZE) / 2;

  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": name };

  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      data-channel={channel}
      data-format={format}
      data-state={state}
      className={cn("shrink-0 transition-transform duration-150 hover:scale-105", state === "disabled" && "cursor-not-allowed opacity-50", className)}
      {...a11y}
    >
      {!decorative ? <title>{name}</title> : null}
      {paint.kind === "gradient" ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            {paint.stops.map((cor, i) => (
              <stop key={cor} offset={`${(i / (paint.stops.length - 1)) * 100}%`} stopColor={cor} />
            ))}
          </linearGradient>
        </defs>
      ) : null}

      {treatment === "ring" ? (
        <>
          <circle cx="20" cy="20" r="16.5" fill="#FFFFFF" />
          <circle
            cx="20"
            cy="20"
            r={RING_RADIUS}
            fill="none"
            stroke={fill}
            strokeWidth="2"
            strokeLinecap="butt"
            strokeDasharray={`${RING_DASH.toFixed(3)} ${RING_GAP}`}
            strokeDashoffset={(RING_DASH / 2).toFixed(3)}
            transform="rotate(-90 20 20)"
          />
          <path d={config.glyph.path} fill={fill} transform={`translate(${glyphOffset} ${glyphOffset}) scale(${glyphScale.toFixed(4)})`} />
        </>
      ) : (
        <circle cx="20" cy="20" r="20" fill={fill} />
      )}

      {treatment === "filled" ? <path d={config.glyph.path} fill="#FFFFFF" transform={`translate(${glyphOffset} ${glyphOffset}) scale(${glyphScale.toFixed(4)})`} /> : null}

      {treatment === "reels" ? (
        <>
          {/* A claquete: quadro arredondado, faixa superior com dois cortes diagonais, play no centro. */}
          <g fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="11" y="11" width="18" height="18" rx="4" />
            <path d="M11 16.5H29" />
            <path d="M16.5 11L19 16.5M22.5 11L25 16.5" />
          </g>
          <path d="M17.5 19.2L24.5 23L17.5 26.8Z" fill="#FFFFFF" />
          {/* O selo com o logo da rede, borda branca. */}
          <circle cx={40 - BADGE_RADIUS - 2} cy={40 - BADGE_RADIUS - 2} r={BADGE_RADIUS} fill={fill} stroke="#FFFFFF" strokeWidth="1.5" />
          <path
            d={config.glyph.path}
            fill="#FFFFFF"
            transform={`translate(${40 - BADGE_RADIUS - 2 - BADGE_GLYPH / 2} ${40 - BADGE_RADIUS - 2 - BADGE_GLYPH / 2}) scale(${(BADGE_GLYPH / config.glyph.viewBox).toFixed(4)})`}
          />
        </>
      ) : null}
    </svg>
  );
}
