"use client";

import Link from "next/link";
import { useMemo } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useDetalheDaOcorrencia, useMutacoesDePublicacao } from "@/hooks/publicacoes/usePublicacoes";
import type { ExecucaoLida, PublicacaoLida } from "@/lib/publicacoes/servico";
import { horaLocal } from "@/lib/publicacoes/tempo-da-tela";
import { descreverRecorrencia } from "@/lib/publicacoes/recorrencia";
import { ArrowSquareOut, ArrowsClockwise } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { Miniatura } from "./Miniatura";
import {
  PONTO_DA_REDE,
  ROTULO_DA_REDE,
  ROTULO_DO_ERRO,
  ROTULO_DO_FORMATO,
  ROTULO_DO_MOTIVO_DE_PULO,
  ROTULO_DO_STATUS_DA_EXECUCAO,
  ROTULO_DO_STATUS_DA_OCORRENCIA,
  VARIANTE_DO_STATUS_DA_EXECUCAO,
  VARIANTE_DO_STATUS_DA_OCORRENCIA,
} from "./rotulos";

/**
 * O painel lateral de UMA ocorrência: o que é, quando sai, para onde, com
 * que resultado — por destino, por grupo, por Story — e as ações.
 *
 * É o mesmo painel na Lista, no Calendário e no Histórico. No Histórico ele
 * é o "diagnóstico": cada execução mostra tentativa, erro em frase de gente,
 * id externo e o botão de reenviar quando faz sentido.
 */
export function SheetDaOcorrencia({
  ocorrenciaId,
  fuso,
  podeEditar,
  onFechar,
  onAlterarHorario,
  onCancelarOcorrencia,
  onCancelarPublicacao,
  onExcluir,
}: {
  ocorrenciaId: string | null;
  fuso: string;
  podeEditar: boolean;
  onFechar: () => void;
  onAlterarHorario?: (id: string, scheduledAt: string) => void;
  onCancelarOcorrencia?: (id: string) => void;
  onCancelarPublicacao?: (publicacaoId: string) => void;
  onExcluir?: (publicacaoId: string) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isLoading } = useDetalheDaOcorrencia(ocorrenciaId);
  const { reenviar } = useMutacoesDePublicacao();
  const formatador = useMemo(() => new Intl.DateTimeFormat(tag, { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: fuso }), [tag, fuso]);

  const o = data?.occurrence;
  const pub = data?.publication;
  const pendente = o?.status === "pending";

  async function reenviarExecucao(id: string) {
    try {
      await reenviar.mutateAsync(id);
      toast.success(t("Reenvio agendado. Sai na próxima rodada."));
    } catch (err) {
      showApiError(err);
    }
  }

  return (
    <Sheet open={ocorrenciaId !== null} onOpenChange={(aberto) => (!aberto ? onFechar() : null)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg" data-testid="sheet-da-ocorrencia">
        {isLoading || !o || !pub ? (
          <div className="flex flex-col gap-3 p-6" aria-busy="true">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-2 border-b px-6 py-5 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">{pub.title?.trim() || t("Publicação sem título")}</SheetTitle>
                  <SheetDescription className="mt-1 capitalize">
                    {formatador.format(new Date(o.scheduled_at))} · {horaLocal(o.scheduled_at, fuso)}
                  </SheetDescription>
                </div>
                <Badge variant={VARIANTE_DO_STATUS_DA_OCORRENCIA[o.status]}>{t(ROTULO_DO_STATUS_DA_OCORRENCIA[o.status])}</Badge>
              </div>
              {pub.recurrence.kind !== "none" ? (
                <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowsClockwise size={12} aria-hidden />
                  {t(descreverRecorrencia(pub.recurrence.kind, pub.recurrence.config as never) ?? "")}
                </p>
              ) : null}
              {o.status === "skipped" && o.skipped_reason ? (
                <p className="rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning-fg">{t(ROTULO_DO_MOTIVO_DE_PULO[o.skipped_reason] ?? o.skipped_reason)}</p>
              ) : null}
            </SheetHeader>

            <div className="flex flex-col gap-5 px-6 py-5">
              {pub.media.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {pub.media.map((m, i) => (
                    <div key={m.id} className="relative shrink-0">
                      <Miniatura storagePath={m.storage_path} kind={m.kind} className="h-20 w-20" />
                      <span className="absolute left-1 top-1 rounded-sm bg-black/60 px-1 text-[10px] font-semibold text-white">{i + 1}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {pub.body ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{pub.body}</p> : null}

              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Destinos")}</h3>
                {pub.targets
                  .filter((d) => !d.removido || data.executions.some((e) => e.target_id === d.id))
                  .map((d) => (
                    <BlocoDoDestino key={d.id} destino={d} execucoes={data.executions.filter((e) => e.target_id === d.id)} media={pub.media} podeEditar={podeEditar} pendente={pendente} onReenviar={reenviarExecucao} reenviando={reenviar.isPending} />
                  ))}
              </section>
            </div>

            {podeEditar ? (
              <div className="mt-auto flex flex-wrap gap-2 border-t px-6 py-4">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/publicacoes/agendar?editar=${pub.id}`}>{t("Editar")}</Link>
                </Button>
                {pendente && onAlterarHorario ? (
                  <Button variant="outline" size="sm" onClick={() => onAlterarHorario(o.id, o.scheduled_at)}>
                    {t("Alterar horário")}
                  </Button>
                ) : null}
                {pendente && onCancelarOcorrencia ? (
                  <Button variant="outline" size="sm" onClick={() => onCancelarOcorrencia(o.id)}>
                    {t("Cancelar esta data")}
                  </Button>
                ) : null}
                {pendente && onCancelarPublicacao ? (
                  <Button variant="outline" size="sm" onClick={() => onCancelarPublicacao(pub.id)}>
                    {t("Cancelar todas")}
                  </Button>
                ) : null}
                {onExcluir ? (
                  <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => onExcluir(pub.id)}>
                    {t("Excluir")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function BlocoDoDestino({
  destino,
  execucoes,
  media,
  podeEditar,
  pendente,
  onReenviar,
  reenviando,
}: {
  destino: PublicacaoLida["targets"][number];
  execucoes: ExecucaoLida[];
  media: PublicacaoLida["media"];
  podeEditar: boolean;
  pendente: boolean;
  onReenviar: (id: string) => void;
  reenviando: boolean;
}) {
  const t = useT();
  // Só a última tentativa de cada unidade (grupo/arquivo) conta para o placar;
  // as anteriores aparecem dobradas dentro dela.
  const porUnidade = useMemo(() => {
    const m = new Map<string, ExecucaoLida[]>();
    for (const e of execucoes) {
      const k = `${e.group_id ?? ""}/${e.media_id ?? ""}`;
      const lista = m.get(k) ?? [];
      lista.push(e);
      m.set(k, lista);
    }
    return [...m.values()].map((lista) => lista.sort((a, b) => a.attempt - b.attempt)).sort((a, b) => a[0]!.position - b[0]!.position);
  }, [execucoes]);
  const grupos = new Map(destino.groups?.map((g) => [g.id, g]) ?? []);
  const midias = new Map(media.map((m, i) => [m.id, { ...m, indice: i + 1 }]));

  return (
    <div className={cn("rounded-xl border p-3", destino.removido && "opacity-70")}>
      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", PONTO_DA_REDE[destino.network])} aria-hidden />
        <span className="text-sm font-semibold">{ROTULO_DA_REDE[destino.network]}</span>
        <span className="text-xs text-muted-foreground">· {t(ROTULO_DO_FORMATO[destino.format])}</span>
        {destino.display_name ? <span className="ml-auto truncate text-xs text-muted-foreground">{destino.display_name}</span> : null}
      </div>
      {destino.network === "whatsapp" && pendente && porUnidade.length === 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {(destino.groups ?? []).map((g) => (
            <li key={g.id} className={cn("rounded-full bg-muted px-2 py-0.5 text-[11px]", !g.is_active && "line-through")}>
              {g.name}
            </li>
          ))}
        </ul>
      ) : null}
      {porUnidade.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {porUnidade.map((tentativas) => {
            const ultima = tentativas[tentativas.length - 1]!;
            const grupo = ultima.group_id ? grupos.get(ultima.group_id) : null;
            const midia = ultima.media_id ? midias.get(ultima.media_id) : null;
            const nomeDaUnidade = grupo ? grupo.name : midia ? `${t("Story")} ${midia.indice}` : ultima.group_name ?? null;
            const erro = ultima.error_code ? (ROTULO_DO_ERRO[ultima.error_code] ? t(ROTULO_DO_ERRO[ultima.error_code]!) : ultima.error_message ?? ultima.error_code) : null;
            const reenviavel = podeEditar && (ultima.status === "failed" || ultima.status === "skipped" || ultima.status === "cancelled");
            return (
              <li key={ultima.id} className="rounded-lg bg-muted/40 px-3 py-2 text-xs" data-testid={`execucao-${ultima.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {nomeDaUnidade ? <span className="font-medium">{nomeDaUnidade}</span> : null}
                  <Badge variant={VARIANTE_DO_STATUS_DA_EXECUCAO[ultima.status]}>{t(ROTULO_DO_STATUS_DA_EXECUCAO[ultima.status])}</Badge>
                  {tentativas.length > 1 ? (
                    <span className="text-muted-foreground">
                      {t("tentativa")} {ultima.attempt}
                    </span>
                  ) : null}
                  {ultima.external_url ? (
                    <a href={ultima.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                      {t("Ver no destino")}
                      <ArrowSquareOut size={12} aria-hidden />
                    </a>
                  ) : null}
                  {reenviavel ? (
                    <Button variant="outline" size="sm" className="ml-auto h-7 px-2 text-[11px]" disabled={reenviando} onClick={() => onReenviar(ultima.id)}>
                      {t("Reenviar")}
                    </Button>
                  ) : null}
                </div>
                {erro ? <p className="mt-1 text-error-fg">{erro}</p> : null}
                {ultima.external_post_id && !ultima.external_url ? <p className="mt-1 font-mono text-[10px] text-muted-foreground">{ultima.external_post_id}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
