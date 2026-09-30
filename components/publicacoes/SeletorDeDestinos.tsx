"use client";

import Link from "next/link";
import { useMemo } from "react";

import { SeletorDeGrupos, type GrupoSelecionavel } from "@/components/disparo/SeletorDeGrupos";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/hooks/i18n/useT";
import { FORMATOS_POR_REDE, REDES_DA_PUBLICACAO, chaveDeDestino, type DestinoDaPublicacao, type FormatoDaPublicacao, type RedeDaPublicacao } from "@/lib/publicacoes/schema";
import type { ProblemaDoDestino } from "@/lib/publicacoes/regras-por-destino";
import type { ContaPublicavel } from "@/lib/publicacoes/servico";
import { Warning } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { IconeDoDestino } from "./IconeDoDestino";
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
 * ONDE publicar, em uma linha: um ícone por destino (rede + formato), como
 * as ferramentas de agendamento fazem — marcar é acender o ícone. Rede sem
 * conta fica apagada com o caminho para Conexões no tooltip. Embaixo, só
 * para as redes marcadas: a conta (seletor quando há mais de uma), os
 * grupos do WhatsApp e os problemas das regras por formato (`veredito`),
 * já calculados contra o conteúdo atual.
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
  function alternar(rede: RedeDaPublicacao, format: FormatoDaPublicacao) {
    const conta = contaDaRede(rede);
    if (!conta) return;
    const chave = chaveDoDestino({ network: rede, format, channel_session_id: conta });
    const existe = destinos.some((d) => chaveDoDestino(d) === chave);
    if (existe) onChange(destinos.filter((d) => chaveDoDestino(d) !== chave));
    else onChange([...destinos, { network: rede, format, channel_session_id: conta, group_ids: rede === "whatsapp" ? [] : undefined, settings: {} }]);
  }
  function trocarGrupos(contaId: string, ids: string[]) {
    onChange(destinos.map((d) => (d.network === "whatsapp" && d.channel_session_id === contaId ? { ...d, group_ids: ids } : d)));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* A linha de ícones: um por destino possível. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label={t("Onde publicar")} data-testid="linha-de-destinos">
        {REDES_DA_PUBLICACAO.map((rede) => {
          const lista = porRede.get(rede) ?? [];
          const contaId = contaDaRede(rede);
          const semConta = lista.length === 0;
          return (
            <div key={rede} className="flex items-center gap-1.5">
              {FORMATOS_POR_REDE[rede].map((format) => {
                const ligado = destinos.some((d) => d.network === rede && d.format === format);
                const chave = contaId ? chaveDoDestino({ network: rede, format, channel_session_id: contaId }) : "";
                const comErro = ligado && (veredito[chave]?.erros.length ?? 0) > 0;
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
                        className={cn(
                          "rounded-full p-0.5 outline-hidden ring-offset-2 ring-offset-card transition-all focus-visible:ring-2 focus-visible:ring-accent",
                          ligado ? "ring-2 ring-accent" : "opacity-55 hover:opacity-90",
                          semConta && "cursor-not-allowed opacity-30 hover:opacity-30",
                          comErro && "ring-error-fg",
                        )}
                      >
                        <IconeDoDestino rede={rede} formato={format} ligado={ligado} tamanho={38} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {semConta ? `${rotulo} — ${t("Nenhuma conta conectada.")}` : rotulo}
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

      {/* Por rede marcada: a conta, os grupos e o que as regras acusaram. */}
      {REDES_DA_PUBLICACAO.map((rede) => {
        const marcados = destinos.filter((d) => d.network === rede);
        if (marcados.length === 0) return null;
        const lista = porRede.get(rede) ?? [];
        const contaId = contaDaRede(rede);
        const conta = lista.find((c) => c.id === contaId) ?? null;
        // A mesma frase repetida por arquivo (dois arquivos fora do 9:16) aparece uma vez só.
        const unicos = <T extends { mensagem: string }>(lista: T[]) => lista.filter((x, i) => lista.findIndex((y) => y.mensagem === x.mensagem) === i);
        const problemas = marcados
          .map((d) => {
            const v = veredito[chaveDoDestino(d)];
            return { d, v: v ? { erros: unicos(v.erros), avisos: unicos(v.avisos) } : undefined };
          })
          .filter((x) => x.v && (x.v.erros.length > 0 || x.v.avisos.length > 0));
        return (
          <section key={rede} data-testid={`rede-${rede}`} className="flex flex-col gap-2 rounded-xl border p-3">
            <header className="flex items-center gap-2">
              <span className="text-sm font-semibold">{ROTULO_DA_REDE[rede]}</span>
              <span className="text-xs text-muted-foreground">
                {marcados.map((d) => (rede === "whatsapp" ? t("Grupos") : t(ROTULO_DO_FORMATO[d.format]))).join(" · ")}
              </span>
              {conta && !conta.disponivel ? (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-warning-fg" title={t("A conexão não está ativa")}>
                  <Warning size={12} aria-hidden />
                  {t("desconectada")}
                </span>
              ) : null}
            </header>
            {lista.length > 1 ? (
              <Select value={contaId ?? undefined} onValueChange={(v) => trocarConta(rede, v)} disabled={disabled}>
                <SelectTrigger className="h-9 text-xs" aria-label={`${t("Conta")} ${ROTULO_DA_REDE[rede]}`}>
                  <SelectValue placeholder={t("Escolha a conta")} />
                </SelectTrigger>
                <SelectContent>
                  {lista.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {nomeDaContaPublicavel(rede, c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="truncate text-xs text-muted-foreground">{nomeDaContaPublicavel(rede, conta)}</p>
            )}
            {problemas.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {problemas.flatMap(({ d, v }) => [
                  ...v!.erros.map((e, i) => (
                    <li key={`${d.format}-e-${i}`} className="text-[11px] text-error-fg">
                      {t(ROTULO_DO_FORMATO[d.format])}: {t(e.mensagem)}
                    </li>
                  )),
                  ...v!.avisos.map((a, i) => (
                    <li key={`${d.format}-a-${i}`} className="text-[11px] text-muted-foreground">
                      {t(ROTULO_DO_FORMATO[d.format])}: {t(a.mensagem)}
                    </li>
                  )),
                ])}
              </ul>
            ) : null}
            {rede === "whatsapp" && contaId ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">
                  {(marcados[0]!.group_ids ?? []).length} {(marcados[0]!.group_ids ?? []).length === 1 ? t("grupo selecionado") : t("grupos selecionados")}
                </span>
                <SeletorDeGrupos grupos={grupos.filter((g) => g.channel_session_id === contaId)} nomeDaConexao={() => conta?.display_name ?? ""} selecionados={marcados[0]!.group_ids ?? []} onChange={(ids) => trocarGrupos(contaId, ids)} disabled={disabled} />
                {grupos.filter((g) => g.channel_session_id === contaId).length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("Nenhum grupo salvo nesta conexão.")}{" "}
                    <Link href="/app/publicacoes/grupos" className="text-accent hover:underline">
                      {t("Buscar grupos")}
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
