"use client";

import Link from "next/link";
import { useMemo } from "react";

import { SeletorDeGrupos, type GrupoSelecionavel } from "@/components/disparo/SeletorDeGrupos";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { FORMATOS_POR_REDE, REDES_DA_PUBLICACAO, type DestinoDaPublicacao, type FormatoDaPublicacao, type RedeDaPublicacao } from "@/lib/publicacoes/schema";
import type { ProblemaDoDestino } from "@/lib/publicacoes/regras-por-destino";
import type { ContaPublicavel } from "@/lib/publicacoes/servico";
import { Check, Warning } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { PONTO_DA_REDE, ROTULO_DA_REDE, ROTULO_DO_FORMATO } from "./rotulos";

export type ChaveDoDestino = string;
export const chaveDoDestino = (d: { network: string; format: string; channel_session_id: string }): ChaveDoDestino => `${d.network}/${d.format}/${d.channel_session_id}`;

/**
 * ONDE publicar: um card por rede, só com as contas conectadas. Rede sem
 * conta aparece desabilitada com o caminho para Conexões; rede com duas
 * contas mostra um seletor. Os formatos são caixas de marcar; marcar o
 * WhatsApp abre a escolha de conta e de grupos. As regras por formato chegam
 * de fora (`veredito`), já calculadas contra o conteúdo atual.
 */
export function SeletorDeDestinos({
  contas,
  grupos,
  destinos,
  onChange,
  veredito,
  disabled,
  layout = "linha",
}: {
  contas: ContaPublicavel[];
  grupos: GrupoSelecionavel[];
  destinos: DestinoDaPublicacao[];
  onChange: (destinos: DestinoDaPublicacao[]) => void;
  /** Por chave de destino: erros e avisos das regras por formato. */
  veredito: Record<ChaveDoDestino, { erros: ProblemaDoDestino[]; avisos: ProblemaDoDestino[] }>;
  disabled?: boolean;
  /** `coluna` empilha os cards (o Agendar em três colunas); `linha` os põe lado a lado. */
  layout?: "linha" | "coluna";
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
    <div className={cn("grid gap-3", layout === "linha" && "md:grid-cols-3")}>
      {REDES_DA_PUBLICACAO.map((rede) => {
        const lista = porRede.get(rede) ?? [];
        const contaId = contaDaRede(rede);
        const conta = lista.find((c) => c.id === contaId) ?? null;
        const semConta = lista.length === 0;
        const marcados = destinos.filter((d) => d.network === rede);
        return (
          <section key={rede} data-testid={`rede-${rede}`} className={cn("flex flex-col gap-3 rounded-xl border p-3", semConta && "opacity-70", marcados.length > 0 && "border-accent/60")}>
            <header className="flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 rounded-full", PONTO_DA_REDE[rede])} aria-hidden />
              <span className="text-sm font-semibold">{ROTULO_DA_REDE[rede]}</span>
              {conta && !conta.disponivel ? (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-warning-fg" title={t("A conexão não está ativa")}>
                  <Warning size={12} aria-hidden />
                  {t("desconectada")}
                </span>
              ) : null}
            </header>

            {semConta ? (
              <p className="text-xs text-muted-foreground">
                {t("Nenhuma conta conectada.")}{" "}
                <Link href="/app/connections" className="text-accent underline-offset-2 hover:underline">
                  {t("Conectar em Conexões")}
                </Link>
              </p>
            ) : (
              <>
                {lista.length > 1 ? (
                  <Select value={contaId ?? undefined} onValueChange={(v) => trocarConta(rede, v)} disabled={disabled}>
                    <SelectTrigger className="h-9 text-xs" aria-label={`${t("Conta")} ${ROTULO_DA_REDE[rede]}`}>
                      <SelectValue placeholder={t("Escolha a conta")} />
                    </SelectTrigger>
                    <SelectContent>
                      {lista.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {rede === "facebook" ? (c.display_name ?? (c.username ? `@${c.username}` : c.id.slice(0, 8))) : c.username ? `@${c.username}` : (c.display_name ?? c.id.slice(0, 8))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="truncate text-xs text-muted-foreground">{rede === "facebook" ? (conta?.display_name ?? (conta?.username ? `@${conta.username}` : "")) : conta?.username ? `@${conta.username}` : conta?.display_name}</p>
                )}

                <div className="flex flex-col gap-1.5">
                  {FORMATOS_POR_REDE[rede].map((format) => {
                    const chave = contaId ? chaveDoDestino({ network: rede, format, channel_session_id: contaId }) : "";
                    const ligado = marcados.some((d) => d.format === format);
                    const v = veredito[chave];
                    return (
                      <div key={format} className="flex flex-col gap-1">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={ligado}
                          data-testid={`destino-${rede}-${format}`}
                          disabled={disabled || !contaId}
                          onClick={() => alternar(rede, format)}
                          className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors", ligado ? "border-accent bg-accent-soft/50" : "border-border hover:bg-muted/40")}
                        >
                          <span className={cn("flex h-4 w-4 items-center justify-center rounded-sm border", ligado ? "border-accent bg-accent text-white" : "border-border")} aria-hidden>
                            {ligado ? <Check size={12} weight="bold" /> : null}
                          </span>
                          <span>{rede === "whatsapp" ? t("Mensagem nos grupos") : t(ROTULO_DO_FORMATO[format])}</span>
                          {ligado && v && v.erros.length > 0 ? <Warning size={14} className="ml-auto text-error-fg" aria-label={t("Este destino tem problemas")} /> : null}
                        </button>
                        {ligado && v ? (
                          <ul className="ml-1 flex flex-col gap-0.5">
                            {v.erros.map((e, i) => (
                              <li key={`e-${i}`} className="text-[11px] text-error-fg">
                                {t(e.mensagem)}
                              </li>
                            ))}
                            {v.avisos.map((a, i) => (
                              <li key={`a-${i}`} className="text-[11px] text-muted-foreground">
                                {t(a.mensagem)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {rede === "whatsapp" && marcados.length > 0 && contaId ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium">
                      {(marcados[0]!.group_ids ?? []).length} {(marcados[0]!.group_ids ?? []).length === 1 ? t("grupo selecionado") : t("grupos selecionados")}
                    </span>
                    <SeletorDeGrupos
                      grupos={grupos.filter((g) => g.channel_session_id === contaId)}
                      nomeDaConexao={() => conta?.display_name ?? ""}
                      selecionados={marcados[0]!.group_ids ?? []}
                      onChange={(ids) => trocarGrupos(contaId, ids)}
                      disabled={disabled}
                    />
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
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
