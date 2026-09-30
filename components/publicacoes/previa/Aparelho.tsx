"use client";

import { cn } from "@/lib/utils";

/**
 * O aparelho da prévia: um celular em proporção real (9:19,5), moldura
 * escura, entalhe e barra de status — a mesma casca para Instagram,
 * Facebook e WhatsApp, para o olho comparar as redes sem o quadro mudar.
 *
 * As cores aqui são as da interface das redes, de propósito fixas
 * (`bg-[#…]`), como a prévia do WhatsApp já fazia: o que se imita é o
 * aplicativo do outro, não o tema do produto.
 */
export function Aparelho({
  hora,
  tema = "claro",
  children,
  className,
  rotulo,
}: {
  hora: string;
  tema?: "claro" | "escuro";
  children: React.ReactNode;
  className?: string;
  rotulo: string;
}) {
  const escuro = tema === "escuro";
  return (
    <div className={cn("mx-auto w-[300px] select-none 2xl:w-[340px]", className)} role="img" aria-label={rotulo} data-testid="aparelho-de-previa">
      <div className="rounded-[2.6rem] border-[8px] border-[#1c1c1e] bg-[#1c1c1e] shadow-[0_24px_48px_-20px_rgba(0,0,0,0.6)]">
        <div className={cn("relative aspect-[9/19.5] overflow-hidden rounded-[2.1rem]", escuro ? "bg-black text-white" : "bg-white text-[#0f1419]")}>
          {/* Barra de status */}
          <div className={cn("relative z-20 flex h-8 items-center justify-between px-6 text-[11px] font-semibold", escuro ? "text-white" : "text-[#0f1419]")}>
            <span>{hora}</span>
            <span className="absolute top-1.5 left-1/2 h-[18px] w-[86px] -translate-x-1/2 rounded-full bg-[#1c1c1e]" aria-hidden />
            <span className="flex items-center gap-1" aria-hidden>
              <span className="flex items-end gap-[1.5px]">
                {[3, 5, 7, 9].map((h) => (
                  <span key={h} className="w-[3px] rounded-[1px] bg-current" style={{ height: h }} />
                ))}
              </span>
              <span className="inline-block h-[10px] w-[20px] rounded-[3px] border border-current p-[1.5px]">
                <span className="block h-full w-[80%] rounded-[1px] bg-current" />
              </span>
            </span>
          </div>
          <div className="absolute inset-x-0 top-8 bottom-0 flex flex-col overflow-hidden">{children}</div>
          {/* Barra de gesto */}
          <span className={cn("absolute bottom-1.5 left-1/2 z-20 h-1 w-24 -translate-x-1/2 rounded-full", escuro ? "bg-white/70" : "bg-black/70")} aria-hidden />
        </div>
      </div>
    </div>
  );
}

/** A foto do perfil (ou as iniciais) no tamanho pedido. */
export function AvatarDaConta({ nome, url, tamanho = 32, className }: { nome: string; url: string | null; tamanho?: number; className?: string }) {
  const iniciais = nome
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#dbdbdb] text-[#555] font-semibold", className)} style={{ width: tamanho, height: tamanho, fontSize: Math.max(10, tamanho * 0.38) }} aria-hidden>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        iniciais || "•"
      )}
    </span>
  );
}

export interface ContaDaPrevia {
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface MidiaDaPrevia {
  id: string;
  kind: "image" | "video" | "audio" | "document";
  url: string | null;
  nome: string;
  /** Dimensões lidas no navegador (ou da mídia salva) — é o que deixa a prévia enquadrar como a rede. */
  width?: number | null;
  height?: number | null;
}

/**
 * Como a rede chama a conta: no Instagram é o @; no Facebook é o NOME DA
 * PÁGINA (o @ do Instagram ligado a ela não aparece no post). Nunca vazio.
 */
export function nomeDaConta(conta: ContaDaPrevia, padrao: string, rede: "instagram" | "facebook" = "instagram"): string {
  const arroba = conta.username ? conta.username.replace(/^@/, "") : null;
  const nome = conta.displayName?.trim() || null;
  if (rede === "facebook") return nome ?? arroba ?? padrao;
  return arroba ?? nome ?? padrao;
}

/**
 * Uma mídia visual (foto/vídeo) para a área principal.
 *
 * `ajuste` diz como a rede enquadra: `cobrir` preenche o quadro cortando o
 * que sobra (o Feed, quando a proporção está fora do limite); `conter`
 * mostra a mídia inteira com faixas pretas (Stories e Reels, que nunca dão
 * zoom no que não é 9:16). O padrão é cobrir porque o quadro do Feed já vem
 * na proporção da mídia (`proporcaoDoFeed`) — cobrir ali não corta nada.
 */
export function MidiaVisual({ midia, className, poster = false, ajuste = "cobrir" }: { midia: MidiaDaPrevia | null; className?: string; poster?: boolean; ajuste?: "cobrir" | "conter" }) {
  if (!midia || !midia.url || (midia.kind !== "image" && midia.kind !== "video")) {
    return <div className={cn("flex items-center justify-center bg-[#262626] text-[11px] text-white/60", className)}>{midia ? midia.nome : ""}</div>;
  }
  const encaixe = ajuste === "conter" ? "object-contain" : "object-cover";
  if (midia.kind === "video") {
    return <video src={midia.url} muted playsInline loop autoPlay={!poster} preload="metadata" className={cn(encaixe, className)} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={midia.url} alt="" className={cn(encaixe, className)} />;
}
