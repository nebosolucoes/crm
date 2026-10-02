"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { SeletorDeGrupos, type GrupoSelecionavel } from "@/components/disparo/SeletorDeGrupos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/hooks/i18n/useT";
import { FORMATOS_POR_REDE, REDES_DA_PUBLICACAO, chaveDeDestino, type DestinoDaPublicacao, type FormatoDaPublicacao, type RedeDaPublicacao } from "@/lib/publicacoes/schema";
import type { ProblemaDoDestino } from "@/lib/publicacoes/regras-por-destino";
import type { ContaPublicavel } from "@/lib/publicacoes/servico";
import { CheckSquare, Square, UsersThree } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { ChannelIcon, formatoParaChannelFormat } from "./ChannelIcon";
import { aplicarContasNaRede, contasMarcadasDaRede } from "./contas-da-rede";
import { ROTULO_DA_REDE, ROTULO_DO_FORMATO } from "./rotulos";

export type ChaveDoDestino = string;
export const chaveDoDestino = chaveDeDestino;

/** Como a rede chama a conta: o @ no Instagram, o nome da Página no Facebook, o nome da conexão no WhatsApp. */
export function nomeDaContaPublicavel(rede: RedeDaPublicacao, c: ContaPublicavel | null | undefined): string {
  if (!c) return "";
  if (rede === "facebook") return c.display_name ?? (c.username ? `@${c.username}` : c.id.slice(0, 8));
  if (rede === "whatsapp") return c.display_name ?? c.id.slice(0, 8);
  return c.username ? `@${c.username}` : (c.display_name ?? c.id.slice(0, 8));
}

/**
 * ONDE publicar, em uma linha: um ícone por destino (rede + formato) — marcar
 * é acender o ícone. Rede sem conta fica apagada com o caminho para Conexões
 * no tooltip. Embaixo, só o que precisa de escolha: a conta, quando a rede
 * tem mais de uma, e o botão que abre a janela de grupos do WhatsApp (a lista
 * não fica aberta na tela).
 *
 * Instagram e Facebook com MAIS DE UMA conta nunca escolhem a conta sozinhos:
 * acender o ícone abre a janela de contas, e o formato só liga depois que a
 * pessoa marca em quais contas sai (uma ou várias — sai em todas). Com uma
 * conta só, o ícone liga direto. Os problemas das regras por formato (`veredito`)
 * não aparecem aqui: o tooltip do ícone diz o motivo (`data-erro`), e o
 * botão Agendar lista tudo no seu tooltip. Sem anel em volta do ícone
 * marcado — a cor contra o cinza já diz o que está ligado.
 */
export function SeletorDeDestinos({
  contas,
  grupos,
  destinos,
  onChange,
  veredito,
  disabled,
}: {
  contas: ContaPublicavel[];
  grupos: GrupoSelecionavel[];
  destinos: DestinoDaPublicacao[];
  onChange: (destinos: DestinoDaPublicacao[]) => void;
  /** Por chave de destino: erros e avisos das regras por formato. */
  veredito: Record<ChaveDoDestino, { erros: ProblemaDoDestino[]; avisos: ProblemaDoDestino[] }>;
  disabled?: boolean;
}) {
  const t = useT();
  const [gruposAbertos, setGruposAbertos] = useState(false);
  /** A janela de contas: a rede, o formato que a abriu (null = só trocar contas) e o que está marcado nela. */
  const [janelaDeContas, setJanelaDeContas] = useState<{ rede: RedeDaPublicacao; formato: FormatoDaPublicacao | null; marcadas: string[] } | null>(null);
  const porRede = useMemo(() => {
    const m = new Map<RedeDaPublicacao, ContaPublicavel[]>();
    for (const r of REDES_DA_PUBLICACAO) m.set(r, []);
    for (const c of contas) m.get(c.network)?.push(c);
    return m;
  }, [contas]);

  /** A conta "corrente" de uma rede: a de algum destino marcado, senão a primeira disponível. */
  function contaDaRede(rede: RedeDaPublicacao): string | null {
    const marcado = destinos.find((d) => d.network === rede);
    if (marcado) return marcado.channel_session_id;
    const lista = porRede.get(rede) ?? [];
    return (lista.find((c) => c.disponivel) ?? lista[0])?.id ?? null;
  }
  function trocarConta(rede: RedeDaPublicacao, contaId: string) {
    onChange(destinos.map((d) => (d.network === rede ? { ...d, channel_session_id: contaId, group_ids: rede === "whatsapp" ? [] : d.group_ids } : d)));
  }
  /** Rede de conteúdo com mais de uma conta: a conta é sempre escolhida na janela. */
  function escolheContaNaJanela(rede: RedeDaPublicacao): boolean {
    return rede !== "whatsapp" && (porRede.get(rede) ?? []).length > 1;
  }
  function abrirContas(rede: RedeDaPublicacao, formato: FormatoDaPublicacao | null) {
    setJanelaDeContas({ rede, formato, marcadas: contasMarcadasDaRede(destinos, rede) });
  }
  function concluirContas() {
    if (!janelaDeContas) return;
    onChange(aplicarContasNaRede(destinos, janelaDeContas.rede, janelaDeContas.formato, janelaDeContas.marcadas));
    setJanelaDeContas(null);
  }
  function alternar(rede: RedeDaPublicacao, format: FormatoDaPublicacao) {
    if (escolheContaNaJanela(rede)) {
      if (destinos.some((d) => d.network === rede && d.format === format)) onChange(destinos.filter((d) => !(d.network === rede && d.format === format)));
      else abrirContas(rede, format);
      return;
    }
    const conta = contaDaRede(rede);
    if (!conta) return;
    const chave = chaveDoDestino({ network: rede, format, channel_session_id: conta });
    const existe = destinos.some((d) => chaveDoDestino(d) === chave);
    if (existe) onChange(destinos.filter((d) => chaveDoDestino(d) !== chave));
    else {
      onChange([...destinos, { network: rede, format, channel_session_id: conta, group_ids: rede === "whatsapp" ? [] : undefined, settings: {} }]);
      if (rede === "whatsapp") setGruposAbertos(true);
    }
  }
  function trocarGrupos(contaId: string, ids: string[]) {
    onChange(destinos.map((d) => (d.network === "whatsapp" && d.channel_session_id === contaId ? { ...d, group_ids: ids } : d)));
  }

  const whatsapp = destinos.find((d) => d.network === "whatsapp") ?? null;
  const contaDoWhatsApp = whatsapp ? ((porRede.get("whatsapp") ?? []).find((c) => c.id === whatsapp.channel_session_id) ?? null) : null;
  const gruposDaConta = whatsapp ? grupos.filter((g) => g.channel_session_id === whatsapp.channel_session_id) : [];
  const nGrupos = whatsapp?.group_ids?.length ?? 0;
  const redesComEscolhaDeConta = REDES_DA_PUBLICACAO.filter((rede) => !escolheContaNaJanela(rede) && destinos.some((d) => d.network === rede) && (porRede.get(rede) ?? []).length > 1);
  const redesComJanelaDeContas = REDES_DA_PUBLICACAO.filter((rede) => escolheContaNaJanela(rede) && destinos.some((d) => d.network === rede));
  const contasDaJanela = janelaDeContas ? (porRede.get(janelaDeContas.rede) ?? []) : [];

  return (
    <div className="flex flex-col gap-3">
      {/* A linha de ícones: um por destino possível. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label={t("Onde publicar")} data-testid="linha-de-destinos">
        {REDES_DA_PUBLICACAO.map((rede) => {
          const lista = porRede.get(rede) ?? [];
          const semConta = lista.length === 0;
          return (
            <div key={rede} className="flex items-center gap-1" data-testid={`rede-${rede}`}>
              {FORMATOS_POR_REDE[rede].map((format) => {
                const ligado = destinos.some((d) => d.network === rede && d.format === format);
                const erro = ligado ? (destinos.filter((d) => d.network === rede && d.format === format).map((d) => veredito[chaveDoDestino(d)]?.erros[0]?.mensagem).find(Boolean) ?? null) : null;
                const rotulo = `${ROTULO_DA_REDE[rede]} · ${rede === "whatsapp" ? t("Grupos") : t(ROTULO_DO_FORMATO[format])}`;
                return (
                  <Tooltip key={format}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={ligado}
                        aria-label={rotulo}
                        data-testid={`destino-${rede}-${format}`}
                        disabled={disabled || semConta}
                        onClick={() => alternar(rede, format)}
                        data-erro={erro ? "true" : undefined}
                        className={cn("rounded-full p-0.5 outline-hidden ring-offset-2 ring-offset-card transition-all focus-visible:ring-2 focus-visible:ring-accent", semConta && "cursor-not-allowed")}
                      >
                        <ChannelIcon channel={rede} format={formatoParaChannelFormat(format)} state={semConta ? "disabled" : ligado ? "active" : "inactive"} size={30} decorative />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      {semConta ? `${rotulo} — ${t("Nenhuma conta conectada.")}` : erro ? `${rotulo} — ${t(erro)}` : rotulo}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          );
        })}
      </div>
      {REDES_DA_PUBLICACAO.every((r) => (porRede.get(r) ?? []).length === 0) ? (
        <p className="text-xs text-muted-foreground">
          {t("Nenhuma conta conectada.")}{" "}
          <Link href="/app/connections" className="text-accent underline-offset-2 hover:underline">
            {t("Conectar em Conexões")}
          </Link>
        </p>
      ) : null}

      {/* Só o que pede escolha: a conta (quando há mais de uma) e os grupos do WhatsApp. */}
      {redesComEscolhaDeConta.length > 0 || redesComJanelaDeContas.length > 0 || whatsapp ? (
        <div className="flex flex-wrap items-center gap-2">
          {redesComJanelaDeContas.map((rede) => {
            const lista = porRede.get(rede) ?? [];
            const nomes = contasMarcadasDaRede(destinos, rede).map((id) => nomeDaContaPublicavel(rede, lista.find((c) => c.id === id)));
            return (
              <Button key={rede} type="button" variant="outline" size="sm" className="h-8 max-w-full" onClick={() => abrirContas(rede, null)} disabled={disabled} data-testid={`escolher-contas-${rede}`} title={nomes.join(", ")}>
                <ChannelIcon channel={rede} format="feed" state="active" size={16} decorative />
                <span className="truncate">{nomes.length === 1 ? nomes[0] : `${nomes.length} ${t("contas")}`}</span>
              </Button>
            );
          })}
          {redesComEscolhaDeConta.map((rede) => {
            const lista = porRede.get(rede) ?? [];
            const contaId = contaDaRede(rede);
            return (
              <Select key={rede} value={contaId ?? undefined} onValueChange={(v) => trocarConta(rede, v)} disabled={disabled}>
                <SelectTrigger className="h-8 w-auto min-w-[160px] text-xs" aria-label={`${t("Conta")} ${ROTULO_DA_REDE[rede]}`}>
                  <SelectValue placeholder={t("Escolha a conta")} />
                </SelectTrigger>
                <SelectContent>
                  {lista.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {ROTULO_DA_REDE[rede]} · {nomeDaContaPublicavel(rede, c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
          {whatsapp ? (
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setGruposAbertos(true)} disabled={disabled} data-testid="escolher-grupos">
              <UsersThree size={14} aria-hidden />
              {nGrupos === 0 ? t("Escolher grupos") : `${nGrupos} ${nGrupos === 1 ? t("grupo") : t("grupos")}`}
            </Button>
          ) : null}
        </div>
      ) : null}
      {whatsapp && nGrupos > 0 ? (
        <ul className="-mt-1 flex flex-col gap-0.5 pl-1 text-xs text-muted-foreground" data-testid="grupos-escolhidos">
          {(whatsapp.group_ids ?? []).map((id) => {
            const g = gruposDaConta.find((x) => x.id === id);
            return g ? (
              <li key={id} className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/60" aria-hidden />
                {g.name}
              </li>
            ) : null;
          })}
        </ul>
      ) : null}

      {/* A janela de contas: Instagram/Facebook com mais de uma conta. */}
      <Dialog open={janelaDeContas !== null} onOpenChange={(aberta) => (aberta ? undefined : setJanelaDeContas(null))}>
        {janelaDeContas ? (
          <DialogContent className="sm:max-w-md" data-testid="dialogo-de-contas">
            <DialogHeader>
              <DialogTitle>
                {t("Contas do")} {ROTULO_DA_REDE[janelaDeContas.rede]}
                {janelaDeContas.formato ? ` · ${t(ROTULO_DO_FORMATO[janelaDeContas.formato])}` : ""}
              </DialogTitle>
              <DialogDescription>{t("Você tem mais de uma conta nesta rede. Marque em quais esta publicação vai sair — ela sai em todas as marcadas.")}</DialogDescription>
            </DialogHeader>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border" role="group" aria-label={t("Contas")}>
              {contasDaJanela.map((c) => {
                const marcada = janelaDeContas.marcadas.includes(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={marcada}
                      disabled={disabled || (!c.disponivel && !marcada)}
                      data-testid={`conta-${c.id}`}
                      onClick={() => setJanelaDeContas((j) => (j ? { ...j, marcadas: marcada ? j.marcadas.filter((id) => id !== c.id) : [...j.marcadas, c.id] } : j))}
                      className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60", marcada && "bg-primary/5")}
                    >
                      {marcada ? <CheckSquare size={18} weight="fill" className="shrink-0 text-primary" aria-hidden /> : <Square size={18} className="shrink-0 text-muted-foreground" aria-hidden />}
                      {c.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- avatar remoto da rede, sem domínio fixo para o next/image
                        <img src={c.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                      ) : (
                        <ChannelIcon channel={janelaDeContas.rede} format="feed" state="active" size={32} decorative />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{nomeDaContaPublicavel(janelaDeContas.rede, c)}</span>
                      {!c.disponivel ? <span className="text-[11px] text-muted-foreground">{t("desconectada")}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setJanelaDeContas(null)} data-testid="cancelar-contas">
                {t("Cancelar")}
              </Button>
              <Button type="button" onClick={concluirContas} disabled={janelaDeContas.formato !== null && janelaDeContas.marcadas.length === 0} data-testid="concluir-contas">
                {janelaDeContas.formato === null && janelaDeContas.marcadas.length === 0 ? t("Tirar da publicação") : t("Concluir")}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* A janela de grupos: a lista só aparece quando a pessoa pede. */}
      {whatsapp ? (
        <Dialog open={gruposAbertos} onOpenChange={setGruposAbertos}>
          <DialogContent className="sm:max-w-md" data-testid="dialogo-de-grupos">
            <DialogHeader>
              <DialogTitle>{t("Grupos do WhatsApp")}</DialogTitle>
              <DialogDescription>{t("Marque os grupos que recebem esta publicação.")}</DialogDescription>
            </DialogHeader>
            <SeletorDeGrupos grupos={gruposDaConta} nomeDaConexao={() => contaDoWhatsApp?.display_name ?? ""} selecionados={whatsapp.group_ids ?? []} onChange={(ids) => trocarGrupos(whatsapp.channel_session_id, ids)} disabled={disabled} />
            {gruposDaConta.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t("Nenhum grupo salvo nesta conexão.")}{" "}
                <Link href="/app/publicacoes/grupos" className="text-accent hover:underline">
                  {t("Buscar grupos")}
                </Link>
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" onClick={() => setGruposAbertos(false)} data-testid="concluir-grupos">
                {t("Concluir")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
