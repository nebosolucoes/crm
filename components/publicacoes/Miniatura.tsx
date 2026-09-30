"use client";

import { useEffect, useState } from "react";

import { urlAssinadaDaMidia } from "@/hooks/publicacoes/usePublicacoes";
import { ImageIcon, MusicNote, FileText, MonitorPlay } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * A miniatura de uma mídia guardada no bucket privado: pede a URL assinada
 * (10 min) e mostra a imagem ou o primeiro quadro do vídeo; áudio e documento
 * viram ícone. Sem URL, cai no ícone do tipo — nunca fica em branco.
 */
export function Miniatura({
  storagePath,
  kind,
  className,
  alt,
}: {
  storagePath: string | null;
  kind: string | null;
  className?: string;
  alt?: string;
}) {
  // Guarda a URL junto com o caminho que a gerou: trocar de arquivo invalida a
  // anterior sem um setState síncrono dentro do efeito.
  const [carregada, setCarregada] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!storagePath || (kind !== "image" && kind !== "video")) return;
    void urlAssinadaDaMidia(storagePath).then((u) => {
      if (vivo) setCarregada({ path: storagePath, url: u });
    });
    return () => {
      vivo = false;
    };
  }, [storagePath, kind]);
  const url = carregada && carregada.path === storagePath ? carregada.url : null;

  const Icone = kind === "video" ? MonitorPlay : kind === "audio" ? MusicNote : kind === "document" ? FileText : ImageIcon;
  return (
    <div className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground", className)}>
      {url && kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt ?? ""} className="h-full w-full object-cover" />
      ) : url && kind === "video" ? (
        <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <Icone size={20} aria-hidden />
      )}
    </div>
  );
}
