"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/hooks/i18n/useT";
import { descreverRecorrencia } from "@/lib/publicacoes/recorrencia";
import { MAXIMO_DE_DATAS_POR_PUBLICACAO, type DestinoDaPublicacao, type RecorrenciaDaPublicacao, type TipoDeRecorrencia } from "@/lib/publicacoes/schema";
import { instanteParaParede, mesmaHoraOutroDia, paredeParaInstante } from "@/lib/publicacoes/tempo-da-tela";
import { Plus, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { ChannelIcon, formatoParaChannelFormat } from "./ChannelIcon";
import { chaveDoDestino, type ChaveDoDestino } from "./SeletorDeDestinos";
import { ROTULO_DA_REDE, ROTULO_DO_FORMATO } from "./rotulos";

const DIAS = [0, 1, 2, 3, 4, 5, 6] as const;
const NOME_DO_DIA: Record<number, string> = { 0: "D", 1: "S", 2: "T", 3: "Q", 4: "Q", 5: "S", 6: "S" };

/**
 * Uma linha de data/hora na tela. `excluidos` são as chaves dos destinos que
 * NÃO saem nesta data — guardar o que está desligado (e não o que está
 * ligado) faz um destino recém-marcado nascer aceso em todas as datas, que é
 * o que a pessoa espera; a API recebe o complemento (`targets`), ou `null`
 * quando nada foi desligado.
 */
export interface HorarioDaTela {
  iso: string;
  excluidos: ChaveDoDestino[];
}

/** O que sai numa linha, na forma da API: `null` = todos. */
export function destinosDaLinha(linha: HorarioDaTela, destinos: DestinoDaPublicacao[]): ChaveDoDestino[] | null {
  const todas = destinos.map(chaveDoDestino);
  const ligadas = todas.filter((k) => !linha.excluidos.includes(k));
  return ligadas.length === todas.length ? null : ligadas;
}

/**
 * QUANDO: uma lista de datas/horas, cada uma com os ícones das redes
 * marcadas — apagar um ícone tira aquela rede daquela data ("o Feed às
 * 19:30, os Stories só amanhã ao meio-dia"). Atalhos clonam a última linha,
 * e o painel de recorrência (recolhido) gera as demais a partir da primeira,
 * sempre em todos os destinos.
 *
 * Os inputs são `datetime-local` lidos e escritos NO FUSO da publicação.
 */
export function SeletorDeHorarios({
  horarios,
  onChange,
  destinos,
  recorrencia,
  onRecorrencia,
  fuso,
  disabled,
}: {
  horarios: HorarioDaTela[];
  onChange: (horarios: HorarioDaTela[]) => void;
  /** Os destinos marcados no passo 1 — os ícones de cada linha. */
  destinos: DestinoDaPublicacao[];
  recorrencia: RecorrenciaDaPublicacao;
  onRecorrencia: (r: RecorrenciaDaPublicacao) => void;
  fuso: string;
  disabled?: boolean;
}) {
  const t = useT();
  const ultima = horarios[horarios.length - 1] ?? null;

  function mudar(i: number, valor: string) {
    const iso = paredeParaInstante(valor, fuso);
    if (!iso) return;
    onChange(horarios.map((h, j) => (j === i ? { ...h, iso } : h)));
  }
  function adicionar(dias: number) {
    if (horarios.length >= MAXIMO_DE_DATAS_POR_PUBLICACAO) return;
    const base = ultima?.iso ?? new Date().toISOString();
    const nova = mesmaHoraOutroDia(base, dias, fuso);
    if (horarios.some((h) => h.iso === nova)) return;
    onChange([...horarios, { iso: nova, excluidos: [] }]);
  }
  function remover(i: number) {
    if (horarios.length <= 1) return;
    onChange(horarios.filter((_, j) => j !== i));
  }
  function alternarDestino(i: number, chave: ChaveDoDestino) {
    onChange(
      horarios.map((h, j) => {
        if (j !== i) return h;
        const desligado = h.excluidos.includes(chave);
        return { ...h, excluidos: desligado ? h.excluidos.filter((k) => k !== chave) : [...h.excluidos, chave] };
      }),
    );
  }
  const setKind = (kind: TipoDeRecorrencia) => onRecorrencia({ ...recorrencia, kind, config: kind === "weekdays" ? { weekdays: recorrencia.config.weekdays ?? [1, 3, 5] } : kind === "none" ? {} : { interval: recorrencia.config.interval ?? 1 } });
  const descricao = descreverRecorrencia(recorrencia.kind, recorrencia.config);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {horarios.map((h, i) => {
          const semRede = destinos.length > 0 && destinosDaLinha(h, destinos)?.length === 0;
          return (
            <div key={i} className={cn("flex flex-wrap items-center gap-2 rounded-xl border p-2", semRede && "border-error-fg/60")} data-testid={`horario-linha-${i + 1}`}>
              <Label htmlFor={`horario-${i}`} className="sr-only">
                {i === 0 ? t("Primeira") : `${i + 1}ª`}
              </Label>
              <Input id={`horario-${i}`} type="datetime-local" value={instanteParaParede(h.iso, fuso)} onChange={(e) => mudar(i, e.target.value)} disabled={disabled} className="h-9 w-[190px] text-xs" data-testid={`horario-${i + 1}`} />
              <div className="flex items-center gap-1" role="group" aria-label={t("Redes desta data")}>
                {destinos.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">{t("Marque as redes no passo 1")}</span>
                ) : (
                  destinos.map((d) => {
                    const chave = chaveDoDestino(d);
                    const ligado = !h.excluidos.includes(chave);
                    const rotulo = `${ROTULO_DA_REDE[d.network]} · ${d.network === "whatsapp" ? t("Grupos") : t(ROTULO_DO_FORMATO[d.format])}`;
                    return (
                      <Tooltip key={chave}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={ligado}
                            aria-label={rotulo}
                            data-testid={`horario-${i + 1}-destino-${d.network}-${d.format}`}
                            disabled={disabled}
                            onClick={() => alternarDestino(i, chave)}
                            className="rounded-full p-px outline-hidden transition-all focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <ChannelIcon channel={d.network} format={formatoParaChannelFormat(d.format)} state={ligado ? "active" : "inactive"} size={26} decorative />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{ligado ? rotulo : `${rotulo} — ${t("não sai nesta data")}`}</TooltipContent>
                      </Tooltip>
                    );
                  })
                )}
              </div>
              {horarios.length > 1 ? (
                <Button type="button" variant="ghost" size="icon" className="ml-auto h-8 w-8" aria-label={t("Remover este horário")} onClick={() => remover(i)} disabled={disabled}>
                  <Trash size={14} aria-hidden />
                </Button>
              ) : null}
              {semRede ? <p className="w-full text-[11px] text-error-fg">{t("Esta data está sem nenhuma rede.")}</p> : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => adicionar(1)} disabled={disabled || horarios.length >= MAXIMO_DE_DATAS_POR_PUBLICACAO}>
          <Plus size={14} aria-hidden />
          {t("Incluir mais dias e horários")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => adicionar(1)} disabled={disabled || !ultima}>
          {t("Amanhã, mesmo horário")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => adicionar(2)} disabled={disabled || !ultima}>
          {t("Depois de amanhã")}
        </Button>
      </div>

      <div className="rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-sm font-medium">{t("Repetir")}</Label>
          <Select value={recorrencia.kind} onValueChange={(v) => setKind(v as TipoDeRecorrencia)} disabled={disabled}>
            <SelectTrigger className="h-9 w-[200px] text-xs" data-testid="recorrencia-tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("Não repetir")}</SelectItem>
              <SelectItem value="daily">{t("Todo dia")}</SelectItem>
              <SelectItem value="weekdays">{t("Dias da semana")}</SelectItem>
              <SelectItem value="weekly">{t("Toda semana")}</SelectItem>
              <SelectItem value="monthly">{t("Todo mês")}</SelectItem>
              <SelectItem value="custom">{t("A cada N dias")}</SelectItem>
            </SelectContent>
          </Select>
          {descricao ? <span className="text-xs text-muted-foreground">{t(descricao)}</span> : null}
        </div>
        {recorrencia.kind !== "none" ? (
          <>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("As datas geradas pela repetição saem em todas as redes marcadas.")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {recorrencia.kind === "weekdays" ? (
                <div className="sm:col-span-3">
                  <span className="text-xs text-muted-foreground">{t("Quais dias")}</span>
                  <div className="mt-1 flex gap-1">
                    {DIAS.map((d) => {
                      const ligado = (recorrencia.config.weekdays ?? []).includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          role="checkbox"
                          aria-checked={ligado}
                          aria-label={["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][d]}
                          disabled={disabled}
                          onClick={() => {
                            const atual = new Set(recorrencia.config.weekdays ?? []);
                            if (ligado) atual.delete(d);
                            else atual.add(d);
                            onRecorrencia({ ...recorrencia, config: { ...recorrencia.config, weekdays: [...atual].sort() } });
                          }}
                          className={cn("flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold", ligado ? "border-accent bg-accent text-white" : "border-border text-muted-foreground")}
                        >
                          {NOME_DO_DIA[d]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <Label htmlFor="rec-intervalo" className="text-xs text-muted-foreground">
                    {recorrencia.kind === "custom" ? t("A cada quantos dias") : t("A cada")}
                  </Label>
                  <Input
                    id="rec-intervalo"
                    type="number"
                    min={1}
                    max={365}
                    value={recorrencia.config.interval ?? 1}
                    disabled={disabled}
                    onChange={(e) => onRecorrencia({ ...recorrencia, config: { ...recorrencia.config, interval: Math.max(1, Number(e.target.value) || 1) } })}
                    className="mt-1 h-9"
                  />
                </div>
              )}
              <div>
                <Label htmlFor="rec-ate" className="text-xs text-muted-foreground">
                  {t("Até (opcional)")}
                </Label>
                <Input
                  id="rec-ate"
                  type="datetime-local"
                  value={recorrencia.repeat_until ? instanteParaParede(recorrencia.repeat_until, fuso) : ""}
                  disabled={disabled}
                  onChange={(e) => onRecorrencia({ ...recorrencia, repeat_until: e.target.value ? paredeParaInstante(e.target.value, fuso) : null })}
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label htmlFor="rec-max" className="text-xs text-muted-foreground">
                  {t("Quantas vezes (opcional)")}
                </Label>
                <Input
                  id="rec-max"
                  type="number"
                  min={1}
                  max={1000}
                  value={recorrencia.max_occurrences ?? ""}
                  disabled={disabled}
                  onChange={(e) => onRecorrencia({ ...recorrencia, max_occurrences: e.target.value ? Math.max(1, Number(e.target.value) || 1) : null })}
                  className="mt-1 h-9"
                />
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
