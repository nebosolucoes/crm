"use client";

/**
 * SUGERIR LEGENDA — o botão ao lado do campo Legenda no Agendar e o painel com
 * a sugestão embaixo dele.
 *
 * A IA lê a instrução da rede (Publicações › Instruções de legenda), até 4
 * imagens anexadas e o texto que já está no campo, como ideia. Com destinos em
 * mais de uma rede, o botão pergunta QUAL instrução usar — cada rede tem a sua.
 * A sugestão nunca substitui o campo sozinha: só no "Usar".
 *
 * O estado mora em `useSugestaoDeLegenda` porque o botão e o painel ficam em
 * lugares diferentes da coluna (acima e abaixo do textarea).
 */
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/hooks/i18n/useT";
import { FalhaDaLegenda, sugerirLegendaComIa } from "@/hooks/publicacoes/usePublicacoes";
import { MAXIMO_DE_IMAGENS_LIDAS } from "@/lib/publicacoes/legenda/montar-pedido";
import type { LegendaSugerida } from "@/lib/publicacoes/legenda/sugerir";
import { REDES_DA_PUBLICACAO, type DestinoDaPublicacao, type RedeDaPublicacao } from "@/lib/publicacoes/schema";
import { ArrowsClockwise, CircleNotch, Sparkle, X } from "@/lib/ui/icons";

import { ChannelIcon } from "./ChannelIcon";
import type { AnexoLocal } from "./DropzoneDeMidia";
import { ROTULO_DA_REDE } from "./rotulos";

/** Erros cujo conserto mora em IA › Provedores — o painel leva o link. */
const CONSERTO_EM_PROVEDORES = new Set(["modelo_sem_visao", "ia_nao_configurada", "modelo_nao_habilitado"]);

export interface EstadoDaSugestao {
  redes: RedeDaPublicacao[];
  imagens: AnexoLocal[];
  videos: number;
  podeSugerir: boolean;
  motivoDesligado: string | null;
  gerando: RedeDaPublicacao | null;
  sugestao: LegendaSugerida | null;
  falha: FalhaDaLegenda | null;
  sugerir: (rede: RedeDaPublicacao) => Promise<void>;
  descartar: () => void;
}

export function useSugestaoDeLegenda(p: {
  destinos: readonly DestinoDaPublicacao[];
  anexos: readonly AnexoLocal[];
  legenda: string;
  /** Sobe (se preciso) os anexos indicados e devolve o `storage_path` de cada um, na ordem. */
  subirImagens: (ids: string[]) => Promise<string[]>;
}): EstadoDaSugestao {
  const t = useT();
  const [gerando, setGerando] = useState<RedeDaPublicacao | null>(null);
  const [sugestao, setSugestao] = useState<LegendaSugerida | null>(null);
  const [falha, setFalha] = useState<FalhaDaLegenda | null>(null);

  const marcadas = new Set(p.destinos.map((d) => d.network));
  const redes = REDES_DA_PUBLICACAO.filter((r) => marcadas.has(r));
  const imagens = p.anexos.filter((a) => a.kind === "image").slice(0, MAXIMO_DE_IMAGENS_LIDAS);
  const videos = p.anexos.filter((a) => a.kind === "video").length;
  const temConteudo = imagens.length > 0 || p.legenda.trim().length > 0;

  let motivoDesligado: string | null = null;
  if (redes.length === 0) motivoDesligado = t("Marque pelo menos uma rede no passo 1.");
  else if (!temConteudo) motivoDesligado = t("Anexe uma imagem ou escreva uma ideia na legenda.");

  async function sugerir(rede: RedeDaPublicacao) {
    setGerando(rede);
    setFalha(null);
    try {
      const media_paths = await p.subirImagens(imagens.map((a) => a.id));
      const formats = [...new Set(p.destinos.filter((d) => d.network === rede).map((d) => d.format))];
      setSugestao(await sugerirLegendaComIa({ network: rede, formats, idea: p.legenda, media_paths, ignored_videos: videos }));
    } catch (err) {
      setSugestao(null);
      setFalha(err instanceof FalhaDaLegenda ? err : new FalhaDaLegenda("erro", err instanceof Error ? err.message : t("Não foi possível sugerir a legenda.")));
    } finally {
      setGerando(null);
    }
  }

  return {
    redes,
    imagens,
    videos,
    podeSugerir: motivoDesligado === null,
    motivoDesligado,
    gerando,
    sugestao,
    falha,
    sugerir,
    descartar: () => {
      setSugestao(null);
      setFalha(null);
    },
  };
}

export function BotaoSugerirLegenda({ estado, disabled }: { estado: EstadoDaSugestao; disabled?: boolean }) {
  const t = useT();
  const [escolhendo, setEscolhendo] = useState(false);
  const ocupado = estado.gerando !== null;
  const desligado = disabled || ocupado || !estado.podeSugerir;

  const conteudo = (
    <>
      {ocupado ? <CircleNotch size={14} className="animate-spin" aria-hidden /> : <Sparkle size={14} weight="fill" aria-hidden />}
      {ocupado ? (estado.imagens.length > 0 ? t("Lendo as imagens…") : t("Escrevendo…")) : t("Sugerir legenda")}
    </>
  );

  if (!estado.podeSugerir) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex" data-testid="sugerir-legenda-bloqueado">
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled aria-disabled title={estado.motivoDesligado ?? undefined} data-testid="sugerir-legenda">
              {conteudo}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {estado.motivoDesligado}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (estado.redes.length === 1) {
    return (
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled={desligado} onClick={() => void estado.sugerir(estado.redes[0]!)} data-testid="sugerir-legenda">
        {conteudo}
      </Button>
    );
  }

  return (
    <Popover open={escolhendo} onOpenChange={setEscolhendo}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled={desligado} data-testid="sugerir-legenda">
          {conteudo}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2" data-testid="sugerir-legenda-redes">
        <p className="px-2 pb-1 pt-1 text-xs font-medium">{t("Usar a instrução de qual rede?")}</p>
        <p className="px-2 pb-2 text-[11px] text-muted-foreground">{t("Cada rede tem o seu jeito de escrever. A legenda vale para todas; ajuste depois se quiser.")}</p>
        <div className="flex flex-col">
          {estado.redes.map((rede) => (
            <button
              key={rede}
              type="button"
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
              onClick={() => {
                setEscolhendo(false);
                void estado.sugerir(rede);
              }}
              data-testid={`sugerir-legenda-rede-${rede}`}
            >
              <ChannelIcon channel={rede} format="feed" state="active" size={22} decorative />
              {ROTULO_DA_REDE[rede]}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PainelDaSugestao({ estado, onUsar }: { estado: EstadoDaSugestao; onUsar: (texto: string) => void }) {
  const t = useT();
  const { sugestao, falha } = estado;
  if (!sugestao && !falha) return null;

  if (falha) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="sugestao-de-legenda-falha">
        <div className="flex items-start justify-between gap-3">
          <p>{t(falha.message)}</p>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={estado.descartar} aria-label={t("Fechar")}>
            <X size={16} aria-hidden />
          </button>
        </div>
        {CONSERTO_EM_PROVEDORES.has(falha.codigo) ? (
          <Link href="/app/ai/providers" className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline">
            {t("Abrir IA › Provedores")}
          </Link>
        ) : null}
      </div>
    );
  }

  const s = sugestao!;
  const nota = [
    s.personalizada ? `${t("Instrução do")} ${ROTULO_DA_REDE[s.network]}` : `${t("Instrução padrão do")} ${ROTULO_DA_REDE[s.network]}`,
    s.used_images === 0 ? t("sem imagem") : s.used_images === 1 ? t("1 imagem lida") : `${s.used_images} ${t("imagens lidas")}`,
    s.ignored_videos > 0 ? (s.ignored_videos === 1 ? t("1 vídeo ignorado") : `${s.ignored_videos} ${t("vídeos ignorados")}`) : null,
  ].filter(Boolean);

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="sugestao-de-legenda">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary">
        <Sparkle size={14} weight="fill" aria-hidden />
        {t("Sugestão da IA")}
      </p>
      <p className="whitespace-pre-wrap text-sm" data-testid="sugestao-de-legenda-texto">
        {s.caption}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground" data-testid="sugestao-de-legenda-nota">
        {nota.join(" · ")} ·{" "}
        <Link href="/app/publicacoes/instrucoes" className="underline-offset-4 hover:underline">
          {t("editar instrução")}
        </Link>
      </p>
      {estado.videos > 0 ? <p className="mt-1 text-[11px] text-muted-foreground">{t("A IA não assiste vídeo; se ele for o principal do post, descreva-o na legenda.")}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            onUsar(s.caption);
            estado.descartar();
          }}
          data-testid="sugestao-de-legenda-usar"
        >
          {t("Usar")}
        </Button>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={estado.gerando !== null} onClick={() => void estado.sugerir(s.network)} data-testid="sugestao-de-legenda-outra">
          {estado.gerando ? <CircleNotch size={14} className="animate-spin" aria-hidden /> : <ArrowsClockwise size={14} aria-hidden />}
          {t("Gerar outra")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={estado.descartar} data-testid="sugestao-de-legenda-descartar">
          {t("Descartar")}
        </Button>
      </div>
    </div>
  );
}
