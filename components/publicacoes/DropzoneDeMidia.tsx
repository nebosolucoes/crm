"use client";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { formatBytes } from "@/components/inbox/media/media-utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import type { MidiaDaPublicacao, TipoDeMidiaDaPublicacao } from "@/lib/publicacoes/schema";
import { MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO } from "@/lib/publicacoes/schema";
import { randomId } from "@/lib/random-id";
import { FileText, MusicNote, Trash, UploadSimple } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/** Um arquivo na tela: local (ainda com `File`) ou já salvo no bucket. */
export interface AnexoLocal {
  id: string;
  kind: TipoDeMidiaDaPublicacao;
  nome: string;
  mime: string;
  sizeBytes: number;
  file: File | null;
  /** O descritor devolvido pelo upload (ou vindo da publicação editada). */
  salvo: MidiaDaPublicacao | null;
  /** Prévia local (object URL) ou URL assinada. */
  url: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  enviando: boolean;
}

const MAX_BYTES = 50 * 1024 * 1024;
const ACEITOS = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip";

export function tipoDoArquivo(mime: string): TipoDeMidiaDaPublicacao {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/** Dimensão (foto/vídeo) e duração (vídeo) lidas no navegador — dicas para as regras por formato. */
export function lerDicasDoArquivo(file: File, url: string | null): Promise<{ width: number | null; height: number | null; duration_ms: number | null }> {
  const vazio = { width: null, height: null, duration_ms: null };
  if (!url) return Promise.resolve(vazio);
  return new Promise((resolve) => {
    const tempo = setTimeout(() => resolve(vazio), 4000);
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => {
        clearTimeout(tempo);
        resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null, duration_ms: null });
      };
      img.onerror = () => {
        clearTimeout(tempo);
        resolve(vazio);
      };
      img.src = url;
    } else if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        clearTimeout(tempo);
        resolve({ width: v.videoWidth || null, height: v.videoHeight || null, duration_ms: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null });
      };
      v.onerror = () => {
        clearTimeout(tempo);
        resolve(vazio);
      };
      v.src = url;
    } else {
      clearTimeout(tempo);
      resolve(vazio);
    }
  });
}

/**
 * Arraste-e-solte de vários arquivos, com ordem editável (a ordem é a dos
 * Stories e a das mensagens no grupo). Controlado pelo pai: quem sobe para o
 * bucket é o formulário, na hora de salvar.
 */
export function DropzoneDeMidia({
  anexos,
  onChange,
  disabled,
}: {
  anexos: AnexoLocal[];
  onChange: (proximos: AnexoLocal[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);

  async function adicionar(lista: FileList | File[] | null) {
    if (!lista) return;
    const arquivos = [...lista];
    if (arquivos.length === 0) return;
    const vagas = MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO - anexos.length;
    if (vagas <= 0) {
      toast.error(`${t("No máximo")} ${MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO} ${t("arquivos por publicação.")}`);
      return;
    }
    const aceitos: AnexoLocal[] = [];
    for (const file of arquivos.slice(0, vagas)) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name}: ${t("o arquivo deve ter no máximo 50 MB.")}`);
        continue;
      }
      if (file.size === 0) {
        toast.error(`${file.name}: ${t("arquivo vazio.")}`);
        continue;
      }
      const mime = file.type || "application/octet-stream";
      const kind = tipoDoArquivo(mime);
      const url = kind === "image" || kind === "video" ? URL.createObjectURL(file) : null;
      const dicas = await lerDicasDoArquivo(file, url);
      aceitos.push({ id: `novo-${randomId()}`, kind, nome: file.name, mime, sizeBytes: file.size, file, salvo: null, url, enviando: false, ...dicas });
    }
    if (arquivos.length > vagas) toast.error(`${t("Só cabem mais")} ${vagas} ${t("arquivo(s).")}`);
    if (aceitos.length > 0) onChange([...anexos, ...aceitos]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remover(id: string) {
    const alvo = anexos.find((a) => a.id === id);
    if (alvo?.url && alvo.file) URL.revokeObjectURL(alvo.url);
    onChange(anexos.filter((a) => a.id !== id));
  }

  function reordenar(r: DropResult) {
    if (!r.destination || r.destination.index === r.source.index) return;
    const proximo = [...anexos];
    const [movido] = proximo.splice(r.source.index, 1);
    proximo.splice(r.destination.index, 0, movido!);
    onChange(proximo);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={t("Adicionar arquivos")}
        data-testid="dropzone-de-midia"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (!disabled) void adicionar(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          arrastando ? "border-accent bg-accent-soft/40" : "border-border hover:bg-muted/30",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <UploadSimple size={22} className="text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{t("Arraste fotos, vídeos ou arquivos aqui")}</p>
        <p className="text-xs text-muted-foreground">
          {t("ou clique para escolher")} · {t("até")} {MAXIMO_DE_ARQUIVOS_POR_PUBLICACAO} {t("arquivos, 50 MB cada")}
        </p>
        <input ref={inputRef} type="file" multiple accept={ACEITOS} className="sr-only" onChange={(e) => void adicionar(e.target.files)} disabled={disabled} />
      </div>

      {anexos.length > 0 ? (
        <DragDropContext onDragEnd={reordenar}>
          <Droppable droppableId="midias" direction="horizontal">
            {(drop) => (
              <ol ref={drop.innerRef} {...drop.droppableProps} className="flex gap-2 overflow-x-auto pb-1" aria-label={t("Arquivos, na ordem em que saem")}>
                {anexos.map((a, i) => (
                  <Draggable key={a.id} draggableId={a.id} index={i} isDragDisabled={disabled}>
                    {(drag) => (
                      <li
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        {...drag.dragHandleProps}
                        className="relative w-24 shrink-0 rounded-lg border bg-card"
                        title={`${a.nome} · ${formatBytes(a.sizeBytes)}`}
                        data-testid={`anexo-${i + 1}`}
                      >
                        <div className="flex h-20 items-center justify-center overflow-hidden rounded-t-lg bg-muted">
                          {a.url && a.kind === "image" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.url} alt="" className="h-full w-full object-cover" />
                          ) : a.url && a.kind === "video" ? (
                            <video src={a.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                          ) : a.kind === "audio" ? (
                            <MusicNote size={22} className="text-muted-foreground" aria-hidden />
                          ) : (
                            <FileText size={22} className="text-muted-foreground" aria-hidden />
                          )}
                        </div>
                        <span className="absolute left-1 top-1 rounded-sm bg-black/60 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
                        <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{a.nome}</p>
                        {!disabled ? (
                          <Button type="button" variant="ghost" size="icon" className="absolute right-0.5 top-0.5 h-6 w-6 bg-black/50 text-white hover:bg-black/70 hover:text-white" aria-label={`${t("Remover")} ${a.nome}`} onClick={() => remover(a.id)}>
                            <Trash size={12} aria-hidden />
                          </Button>
                        ) : null}
                      </li>
                    )}
                  </Draggable>
                ))}
                {drop.placeholder}
              </ol>
            )}
          </Droppable>
        </DragDropContext>
      ) : null}
    </div>
  );
}
