"use client";

import { useEffect, useState } from "react";

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
  barra,
}: {
  hora: string;
  tema?: "claro" | "escuro";
  children: React.ReactNode;
  className?: string;
  rotulo: string;
  /** Cor de fundo da barra de status quando o app pinta a dele (o verde do WhatsApp). */
  barra?: string;
}) {
  const escuro = tema === "escuro";
  return (
    <div className={cn("mx-auto w-[248px] select-none", className)} role="img" aria-label={rotulo} data-testid="aparelho-de-previa">
      <div className="rounded-[2.2rem] border-[7px] border-[#1c1c1e] bg-[#1c1c1e] shadow-[0_20px_40px_-18px_rgba(0,0,0,0.6)]">
        <div className={cn("relative aspect-[9/19.5] overflow-hidden rounded-[1.8rem]", escuro ? "bg-black text-white" : "bg-white text-[#0f1419]")}>
          {/* Barra de status */}
          <div className={cn("relative z-20 flex h-8 items-center justify-between px-6 text-[11px] font-semibold", escuro || barra ? "text-white" : "text-[#0f1419]")} style={barra ? { backgroundColor: barra } : undefined}>
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

/** As cores das quatro bordas de uma imagem (média de uma faixa fina de cada lado). */
interface CoresDaBorda {
  url: string;
  proporcao: number;
  cima: string;
  baixo: string;
  esquerda: string;
  direita: string;
}

/**
 * Lê as cores das bordas no navegador — a mesma conta do envio
 * (`lib/channels/publicacao/enquadrar-story.ts`), numa cópia pequena da imagem.
 * Se o navegador não deixar ler os pixels (imagem de outra origem sem CORS),
 * devolve `null` e quem chama mostra o desfoque leve no lugar.
 */
function useCoresDaBorda(url: string | null): CoresDaBorda | null {
  const [cores, setCores] = useState<CoresDaBorda | null>(null);
  useEffect(() => {
    if (!url) return;
    let vivo = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const largura = 64;
        const altura = Math.max(2, Math.round((largura * img.naturalHeight) / Math.max(1, img.naturalWidth)));
        const canvas = document.createElement("canvas");
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, largura, altura);
        const media = (x: number, y: number, w: number, h: number) => {
          const d = ctx.getImageData(x, y, w, h).data;
          let r = 0;
          let g = 0;
          let b = 0;
          const n = d.length / 4;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i]!;
            g += d[i + 1]!;
            b += d[i + 2]!;
          }
          return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
        };
        const fx = Math.max(1, Math.round(largura * 0.02));
        const fy = Math.max(1, Math.round(altura * 0.02));
        const resultado: CoresDaBorda = {
          url,
          proporcao: img.naturalWidth / Math.max(1, img.naturalHeight),
          cima: media(0, 0, largura, fy),
          baixo: media(0, altura - fy, largura, fy),
          esquerda: media(0, 0, fx, altura),
          direita: media(largura - fx, 0, fx, altura),
        };
        if (vivo) setCores(resultado);
      } catch {
        // Canvas "contaminado" (sem CORS): fica o desfoque de reserva.
      }
    };
    img.src = url;
    return () => {
      vivo = false;
    };
  }, [url]);
  return cores && cores.url === url ? cores : null;
}

/**
 * A mídia como o ENVIO a encaixa (`lib/channels/publicacao/enquadrar-story.ts`):
 * inteira, na proporção dela, e as faixas que sobram na COR DA BORDA vizinha —
 * a de cima em cima, a de baixo embaixo (ou as laterais) —, como o Instagram
 * faz: parece que a foto continua. `proporcaoDoQuadro` (largura/altura) diz
 * se as faixas são em cima e embaixo ou nas laterais. Sem as cores (CORS), a
 * própria imagem com desfoque leve; vídeo fica inteiro sobre preto, como a rede.
 */
export function MidiaEncaixada({
  midia,
  proporcaoDoQuadro,
  className,
  poster = false,
  testId,
}: {
  midia: MidiaDaPrevia | null;
  proporcaoDoQuadro: number;
  className?: string;
  poster?: boolean;
  testId?: string;
}) {
  const imagem = midia?.kind === "image" && midia.url ? midia.url : null;
  const cores = useCoresDaBorda(imagem);
  // Foto mais LARGA que o quadro (proporção maior) encosta nas laterais e sobra em cima e
  // embaixo; mais ESTREITA, encosta em cima e embaixo e sobra nas laterais. (Medido no
  // Playwright: com a comparação invertida o Story pintava as laterais.)
  const vertical = cores ? cores.proporcao > proporcaoDoQuadro : true;
  const fundo = cores
    ? vertical
      ? `linear-gradient(to bottom, ${cores.cima} 0%, ${cores.cima} 50%, ${cores.baixo} 50%, ${cores.baixo} 100%)`
      : `linear-gradient(to right, ${cores.esquerda} 0%, ${cores.esquerda} 50%, ${cores.direita} 50%, ${cores.direita} 100%)`
    : undefined;
  return (
    <div className={cn("relative overflow-hidden bg-black", className)} style={fundo ? { background: fundo } : undefined} data-testid={testId} data-fundo={cores ? "cores-da-borda" : imagem ? "desfoque" : "preto"}>
      {imagem && !cores ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagem} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-xs" />
      ) : null}
      <MidiaVisual midia={midia} className="relative h-full w-full" poster={poster} ajuste="conter" />
    </div>
  );
}
