"use client";

/**
 * SUGERIR LEGENDA — o botão ao lado do campo Legenda no Agendar e o painel com
 * a sugestão embaixo dele.
 *
 * A IA lê o PROMPT das contas marcadas (Publicações › Prompts de legenda), até
 * 4 imagens anexadas e o texto que já está no campo, como ideia. Cada conta
 * leva ao seu prompt (ou ao padrão da rede, se não tiver um); quando as contas
 * marcadas dão em mais de um prompt, o botão pergunta QUAL usar. A sugestão
 * nunca substitui o campo sozinha: só no "Usar".
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
import { FalhaDaLegenda, sugerirLegendaComIa, usePromptsDeLegenda } from "@/hooks/publicacoes/usePublicacoes";
import { opcoesDePrompt, type OpcaoDePrompt } from "@/lib/publicacoes/legenda/instrucoes";
import { MAXIMO_DE_IMAGENS_LIDAS } from "@/lib/publicacoes/legenda/montar-pedido";
import type { LegendaSugerida } from "@/lib/publicacoes/legenda/sugerir";
import type { DestinoDaPublicacao, FormatoDaPublicacao } from "@/lib/publicacoes/schema";
import type { ContaPublicavel } from "@/lib/publicacoes/servico";
import { ArrowsClockwise, CircleNotch, Sparkle, X } from "@/lib/ui/icons";

import { ChannelIcon } from "./ChannelIcon";
import type { AnexoLocal } from "./DropzoneDeMidia";
import { ROTULO_DA_REDE } from "./rotulos";

/** Erros cujo conserto mora em IA › Provedores — o painel leva o link. */
const CONSERTO_EM_PROVEDORES = new Set(["modelo_sem_visao", "ia_nao_configurada", "modelo_nao_habilitado"]);

export interface EstadoDaSugestao {
  opcoes: OpcaoDePrompt[];
  imagens: AnexoLocal[];
  videos: number;
  podeSugerir: boolean;
  motivoDesligado: string | null;
  gerando: boolean;
  sugestao: LegendaSugerida | null;
  falha: FalhaDaLegenda | null;
  sugerir: (opcao: OpcaoDePrompt) => Promise<void>;
  /** A última escolha — o "Gerar outra" repete com ela. */
  ultima: OpcaoDePrompt | null;
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
  const { data: prompts, isLoading } = usePromptsDeLegenda();
  const [gerando, setGerando] = useState(false);
  const [sugestao, setSugestao] = useState<LegendaSugerida | null>(null);
  const [falha, setFalha] = useState<FalhaDaLegenda | null>(null);
  const [ultima, setUltima] = useState<OpcaoDePrompt | null>(null);

  const opcoes = opcoesDePrompt(p.destinos, prompts?.prompts ?? []);
  const imagens = p.anexos.filter((a) => a.kind === "image").slice(0, MAXIMO_DE_IMAGENS_LIDAS);
  const videos = p.anexos.filter((a) => a.kind === "video").length;
  const temConteudo = imagens.length > 0 || p.legenda.trim().length > 0;

  let motivoDesligado: string | null = null;
  if (p.destinos.length === 0) motivoDesligado = t("Marque pelo menos uma rede no passo 1.");
  else if (!temConteudo) motivoDesligado = t("Anexe uma imagem ou escreva uma ideia na legenda.");
  else if (isLoading) motivoDesligado = t("Carregando os prompts…");

  async function sugerir(opcao: OpcaoDePrompt) {
    setGerando(true);
    setFalha(null);
    setUltima(opcao);
    try {
      const media_paths = await p.subirImagens(imagens.map((a) => a.id));
      const escolha = opcao.tipo === "prompt" ? { prompt_id: opcao.prompt_id } : { network: opcao.network };
      const destinos = opcao.destinos.map((d) => ({ network: d.network, format: d.format as FormatoDaPublicacao }));
      setSugestao(await sugerirLegendaComIa({ ...escolha, destinos, idea: p.legenda, media_paths, ignored_videos: videos }));
    } catch (err) {
      setSugestao(null);
      setFalha(err instanceof FalhaDaLegenda ? err : new FalhaDaLegenda("erro", err instanceof Error ? err.message : t("Não foi possível sugerir a legenda.")));
    } finally {
      setGerando(false);
    }
  }

  return {
    opcoes,
    imagens,
    videos,
    podeSugerir: motivoDesligado === null && opcoes.length > 0,
    motivoDesligado,
    gerando,
    sugestao,
    falha,
    sugerir,
    ultima,
    descartar: () => {
      setSugestao(null);
      setFalha(null);
    },
  };
}

/** Como uma opção se chama na tela: o nome do prompt, ou "Padrão do Instagram". */
function useNomeDaOpcao() {
  const t = useT();
  return (o: OpcaoDePrompt) => (o.tipo === "prompt" ? o.nome : `${t("Padrão do")} ${ROTULO_DA_REDE[o.network]}`);
}

export function BotaoSugerirLegenda({ estado, contas, disabled }: { estado: EstadoDaSugestao; contas: readonly ContaPublicavel[]; disabled?: boolean }) {
  const t = useT();
  const nomeDaOpcao = useNomeDaOpcao();
  const [escolhendo, setEscolhendo] = useState(false);
  const desligado = disabled || estado.gerando || !estado.podeSugerir;
  const nomeDaConta = new Map(contas.map((c) => [c.id, c.display_name ?? c.username ?? ROTULO_DA_REDE[c.network]]));

  const conteudo = (
    <>
      {estado.gerando ? <CircleNotch size={14} className="animate-spin" aria-hidden /> : <Sparkle size={14} weight="fill" aria-hidden />}
      {estado.gerando ? (estado.imagens.length > 0 ? t("Lendo as imagens…") : t("Escrevendo…")) : t("Sugerir legenda")}
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

  if (estado.opcoes.length === 1) {
    return (
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled={desligado} onClick={() => void estado.sugerir(estado.opcoes[0]!)} data-testid="sugerir-legenda">
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
      <PopoverContent align="end" className="w-72 p-2" data-testid="sugerir-legenda-prompts">
        <p className="px-2 pb-1 pt-1 text-xs font-medium">{t("Usar qual prompt?")}</p>
        <p className="px-2 pb-2 text-[11px] text-muted-foreground">{t("As contas marcadas usam prompts diferentes. A legenda vale para todas; ajuste depois se quiser.")}</p>
        <div className="flex flex-col">
          {estado.opcoes.map((opcao) => (
            <button
              key={opcao.chave}
              type="button"
              className="flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
              onClick={() => {
                setEscolhendo(false);
                void estado.sugerir(opcao);
              }}
              data-testid={`sugerir-legenda-opcao-${opcao.chave}`}
            >
              <span className="mt-0.5 flex shrink-0 -space-x-1.5">
                {opcao.redes.map((rede) => (
                  <ChannelIcon key={rede} channel={rede} format="feed" state="active" size={20} decorative />
                ))}
              </span>
              <span className="min-w-0">
                <span className="block text-sm">{nomeDaOpcao(opcao)}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{opcao.contas.map((c) => nomeDaConta.get(c) ?? "").filter(Boolean).join(", ")}</span>
              </span>
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
    s.origem.tipo === "prompt" ? `${t("Prompt")} “${s.origem.nome}”` : `${t("Padrão do")} ${ROTULO_DA_REDE[s.origem.network]}`,
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
        <Link href="/app/publicacoes/prompts" className="underline-offset-4 hover:underline">
          {t("editar prompts")}
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={estado.gerando || !estado.ultima}
          onClick={() => estado.ultima && void estado.sugerir(estado.ultima)}
          data-testid="sugestao-de-legenda-outra"
        >
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
