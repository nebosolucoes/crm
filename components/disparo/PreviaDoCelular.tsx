"use client";

import { useEffect, useMemo, useRef } from "react";

import { formatBytes, mediaFileLabel } from "@/components/inbox/media/media-utils";
import { useT } from "@/hooks/i18n/useT";
import {
  tokenizarFormatoDoWhatsApp,
  type TokenDoWhatsApp,
} from "@/lib/disparo/formato-do-whatsapp";
import {
  ArrowLeft,
  Camera,
  Checks,
  DotsThreeVertical,
  FileText,
  Microphone,
  Paperclip,
  Phone,
  Play,
  Smiley,
  UsersThree,
  VideoCamera,
} from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * A PRÉVIA: um celular com o WhatsApp aberto no grupo, mostrando o disparo
 * como ele vai chegar — cada arquivo é uma mensagem, na ordem, e o texto vai
 * como legenda do ÚLTIMO arquivo (ou sozinho, quando não há arquivo). É a
 * mesma ordem que `lib/agendamentos-grupos/worker.ts` envia; se um dia o
 * worker mudar a ordem, esta tela tem de mudar junto — a prévia que mente é
 * pior que nenhuma.
 *
 * As cores são as do WhatsApp (fundo `#efeae2`, balão enviado `#d9fdd3`,
 * cabeçalho `#008069`) DE PROPÓSITO e fixas nos dois temas: o que se imita
 * aqui é o aparelho do cliente, não o tema do CRM.
 */

export type AnexoDaPrevia = {
  id: string;
  kind: "image" | "video" | "audio" | "document";
  /** URL exibível (object URL local ou assinada). `null` = ainda sem prévia. */
  url: string | null;
  nome: string;
  mime: string;
  sizeBytes: number;
};

type Props = {
  /** Nomes dos grupos escolhidos. O primeiro vira o cabeçalho. */
  grupos: string[];
  mensagem: string;
  anexos: AnexoDaPrevia[];
  /** "HH:mm" — a hora agendada, que é a que aparece no balão. */
  horario: string;
  /** A legenda da data no meio da conversa ("HOJE", "18/09/2026"). */
  dataLegenda: string;
  className?: string;
};

function renderizarTokens(tokens: TokenDoWhatsApp[], prefixo: string): React.ReactNode[] {
  return tokens.map((token, i) => {
    const chave = `${prefixo}-${i}`;
    if (token.tipo === "texto") return <span key={chave}>{token.texto}</span>;
    if (token.tipo === "quebra") return <br key={chave} />;
    const filhos = renderizarTokens(token.filhos, chave);
    if (token.estilo === "negrito") return <strong key={chave}>{filhos}</strong>;
    if (token.estilo === "italico") return <em key={chave}>{filhos}</em>;
    if (token.estilo === "riscado") return <s key={chave}>{filhos}</s>;
    return (
      <code key={chave} className="font-mono text-[13px]">
        {filhos}
      </code>
    );
  });
}

function TextoFormatado({ texto }: { texto: string }) {
  const tokens = useMemo(() => tokenizarFormatoDoWhatsApp(texto), [texto]);
  return <>{renderizarTokens(tokens, "t")}</>;
}

function Carimbo({ horario, className }: { horario: string; className?: string }) {
  return (
    <span
      className={cn(
        "float-right mt-1 ml-2 inline-flex items-center gap-0.5 text-[11px] leading-none text-[#667781]",
        className,
      )}
    >
      {horario}
      <Checks size={15} className="text-[#53bdeb]" aria-hidden />
    </span>
  );
}

function Balao({
  children,
  semPreenchimento,
}: {
  children: React.ReactNode;
  semPreenchimento?: boolean;
}) {
  return (
    <div className="flex justify-end">
      <div
        data-balao=""
        className={cn(
          "relative max-w-[86%] rounded-lg rounded-tr-none bg-[#d9fdd3] text-[14px] leading-[19px] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
          semPreenchimento ? "p-[3px]" : "px-2 py-1.5",
        )}
      >
        {/* O rabinho do balão, como no aparelho. */}
        <svg
          viewBox="0 0 8 13"
          width="8"
          height="13"
          className="absolute top-0 -right-2 text-[#d9fdd3]"
          aria-hidden
        >
          <path d="M0 0h8L0 13z" fill="currentColor" />
        </svg>
        {children}
      </div>
    </div>
  );
}

function Legenda({ texto, horario }: { texto: string; horario: string }) {
  return (
    <div className="px-1.5 pt-1 pb-1 break-words whitespace-pre-wrap">
      <TextoFormatado texto={texto} />
      <Carimbo horario={horario} />
    </div>
  );
}

function BalaoDeAnexo({
  anexo,
  legenda,
  horario,
}: {
  anexo: AnexoDaPrevia;
  legenda: string | null;
  horario: string;
}) {
  const t = useT();
  if (anexo.kind === "image") {
    return (
      <Balao semPreenchimento>
        <div className="overflow-hidden rounded-md">
          {anexo.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- prévia local/assinada, fora do allowlist do next/image
            <img
              src={anexo.url}
              alt={anexo.nome}
              className="block max-h-[240px] w-full min-w-[180px] object-cover"
            />
          ) : (
            <div className="flex h-40 w-[220px] items-center justify-center bg-[#cfd7d3] text-[#54656f]">
              <Camera size={28} aria-hidden />
            </div>
          )}
        </div>
        {legenda ? (
          <Legenda texto={legenda} horario={horario} />
        ) : (
          <Carimbo
            horario={horario}
            className="absolute right-2 bottom-1.5 mt-0 rounded-sm px-1 text-white [text-shadow:0_0_2px_rgba(0,0,0,0.6)] [&_svg]:text-white"
          />
        )}
      </Balao>
    );
  }
  if (anexo.kind === "video") {
    return (
      <Balao semPreenchimento>
        <div className="relative overflow-hidden rounded-md bg-black">
          {anexo.url ? (
            <video
              src={anexo.url}
              muted
              playsInline
              preload="metadata"
              className="block max-h-[240px] w-full min-w-[180px] object-cover"
            />
          ) : (
            <div className="flex h-40 w-[220px] items-center justify-center bg-[#2b2f31] text-white">
              <VideoCamera size={28} aria-hidden />
            </div>
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white">
              <Play size={20} weight="fill" aria-hidden />
            </span>
          </span>
        </div>
        {legenda ? (
          <Legenda texto={legenda} horario={horario} />
        ) : (
          <Carimbo
            horario={horario}
            className="absolute right-2 bottom-1.5 mt-0 px-1 text-white [text-shadow:0_0_2px_rgba(0,0,0,0.6)] [&_svg]:text-white"
          />
        )}
      </Balao>
    );
  }
  if (anexo.kind === "audio") {
    return (
      <Balao>
        <div className="flex w-[230px] items-center gap-2 py-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#008069] text-white">
            <Microphone size={18} weight="fill" aria-hidden />
          </span>
          <span className="text-[#667781]">
            <Play size={20} weight="fill" aria-hidden />
          </span>
          <span className="flex flex-1 items-end gap-[2px]" aria-hidden>
            {ONDA.map((altura, i) => (
              <span
                key={i}
                className="w-[2px] rounded-full bg-[#8fa79c]"
                style={{ height: `${altura}px` }}
              />
            ))}
          </span>
        </div>
        <div className="flex items-center justify-between pl-11 text-[11px] text-[#667781]">
          <span>{t("Áudio")}</span>
          <Carimbo horario={horario} className="mt-0" />
        </div>
      </Balao>
    );
  }
  return (
    <Balao>
      <div className="flex w-[230px] items-center gap-2.5 rounded-md bg-[#cdf4c3] px-2.5 py-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#008069]/10 text-[#008069]">
          <FileText size={22} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{anexo.nome}</span>
          <span className="block text-[11px] text-[#667781]">
            {formatBytes(anexo.sizeBytes)} · {mediaFileLabel(anexo.mime, anexo.nome)}
          </span>
        </span>
      </div>
      {legenda ? (
        <Legenda texto={legenda} horario={horario} />
      ) : (
        <div className="flex justify-end">
          <Carimbo horario={horario} />
        </div>
      )}
    </Balao>
  );
}

const ONDA = [
  6, 10, 14, 9, 16, 12, 7, 15, 11, 8, 13, 17, 10, 6, 12, 9, 14, 8, 11, 7, 15, 10, 6, 12, 9, 13,
];

export function PreviaDoCelular({
  grupos,
  mensagem,
  anexos,
  horario,
  dataLegenda,
  className,
}: Props) {
  const t = useT();
  const titulo = grupos[0] ?? t("Grupo do WhatsApp");
  const subtitulo =
    grupos.length > 1
      ? t("e mais {n} grupo(s)").replace("{n}", String(grupos.length - 1))
      : t("toque para dados do grupo");
  const textoLimpo = mensagem.trim();
  const vazio = anexos.length === 0 && textoLimpo.length === 0;

  // Como no aparelho: a conversa fica sempre no fim, onde está a última
  // mensagem — que é a que carrega a legenda. Sem isto, com dois ou três
  // arquivos a legenda ficava escondida abaixo da dobra da prévia.
  const conversaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = conversaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagem, anexos]);

  return (
    <div
      className={cn("mx-auto w-[300px] select-none", className)}
      data-previa-do-celular
      role="img"
      aria-label={t("Prévia da mensagem como aparece no WhatsApp")}
    >
      <div className="rounded-[2.2rem] border-[9px] border-[#1f1f1f] bg-[#1f1f1f] shadow-[0_18px_40px_-16px_rgba(0,0,0,0.55)]">
        <div className="relative overflow-hidden rounded-[1.7rem] bg-[#efeae2]">
          {/* Barra de status */}
          <div className="flex h-7 items-center justify-between bg-[#008069] px-5 text-[11px] font-medium text-white">
            <span>{horario}</span>
            <span
              className="absolute top-1.5 left-1/2 h-4 w-20 -translate-x-1/2 rounded-full bg-[#1f1f1f]"
              aria-hidden
            />
            <span className="flex items-center gap-1" aria-hidden>
              <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-white/90" />
              <span className="inline-block h-2.5 w-5 rounded-[3px] border border-white/90" />
            </span>
          </div>

          {/* Cabeçalho do grupo */}
          <div className="flex items-center gap-2 bg-[#008069] px-2 pt-1 pb-2 text-white">
            <ArrowLeft size={20} aria-hidden />
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-[#8696a0]">
              <UsersThree size={20} weight="fill" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] leading-tight font-medium">{titulo}</span>
              <span className="block truncate text-[11.5px] leading-tight text-white/85">
                {subtitulo}
              </span>
            </span>
            <VideoCamera size={20} aria-hidden />
            <Phone size={18} aria-hidden />
            <DotsThreeVertical size={20} weight="bold" aria-hidden />
          </div>

          {/* A conversa */}
          <div ref={conversaRef} className="relative max-h-[500px] min-h-[380px] overflow-y-auto">
            <FundoDoChat />
            <div className="relative space-y-1.5 px-2.5 pt-2 pb-3">
              <div className="flex justify-center pb-1">
                <span className="rounded-lg bg-white/95 px-3 py-1 text-[11px] font-medium text-[#54656f] uppercase shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
                  {dataLegenda}
                </span>
              </div>
              {vazio ? (
                <div className="flex justify-center pt-8">
                  <span className="max-w-[210px] rounded-lg bg-[#fff5c4] px-3 py-2 text-center text-[12px] text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
                    {t("Escreva a mensagem ou anexe um arquivo para ver como vai chegar.")}
                  </span>
                </div>
              ) : null}
              {anexos.map((anexo, i) => {
                const ultimo = i === anexos.length - 1;
                return (
                  <BalaoDeAnexo
                    key={anexo.id}
                    anexo={anexo}
                    legenda={ultimo && textoLimpo ? textoLimpo : null}
                    horario={horario}
                  />
                );
              })}
              {anexos.length === 0 && textoLimpo ? (
                <Balao>
                  <div className="break-words whitespace-pre-wrap">
                    <TextoFormatado texto={textoLimpo} />
                    <Carimbo horario={horario} />
                  </div>
                </Balao>
              ) : null}
            </div>
          </div>

          {/* Barra de digitação — enfeite: a mensagem já está agendada */}
          <div className="flex items-center gap-1.5 bg-[#f0f2f5] px-2 py-1.5">
            <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[#8696a0]">
              <Smiley size={20} aria-hidden />
              <span className="flex-1 text-[13.5px]">{t("Mensagem")}</span>
              <Paperclip size={18} aria-hidden />
              <Camera size={18} aria-hidden />
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#008069] text-white">
              <Microphone size={18} weight="fill" aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** O padrão de fundo do WhatsApp, em traço leve — só sugestão, não a arte oficial. */
function FundoDoChat() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <pattern id="previa-fundo" width="260" height="260" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#d9d2c5" strokeWidth="1.2" opacity="0.55">
            <circle cx="30" cy="40" r="9" />
            <path d="M70 20l8 8-8 8-8-8z" />
            <path d="M120 60c8-10 20-10 28 0" />
            <circle cx="200" cy="30" r="5" />
            <path d="M230 90h18M239 81v18" />
            <path d="M40 120l12 12M52 120l-12 12" />
            <circle cx="110" cy="140" r="11" />
            <path d="M160 120c6 6 6 14 0 20" />
            <path d="M20 200c10-8 20-8 30 0" />
            <path d="M90 220l8 8-8 8-8-8z" />
            <circle cx="170" cy="210" r="7" />
            <path d="M220 170h14M227 163v14" />
            <path d="M230 240c6-6 14-6 20 0" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#previa-fundo)" />
    </svg>
  );
}
