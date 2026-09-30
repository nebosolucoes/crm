"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { descreverRecorrencia } from "@/lib/publicacoes/recorrencia";
import { MAXIMO_DE_DATAS_POR_PUBLICACAO, type RecorrenciaDaPublicacao, type TipoDeRecorrencia } from "@/lib/publicacoes/schema";
import { instanteParaParede, mesmaHoraOutroDia, paredeParaInstante } from "@/lib/publicacoes/tempo-da-tela";
import { Plus, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

const DIAS = [0, 1, 2, 3, 4, 5, 6] as const;
const NOME_DO_DIA: Record<number, string> = { 0: "D", 1: "S", 2: "T", 3: "Q", 4: "Q", 5: "S", 6: "S" };

/**
 * QUANDO: uma lista de datas/horas (a primeira é a âncora), atalhos que
 * clonam a última linha, e o painel de recorrência (recolhido). O modelo é
 * "1 publicação, N ocorrências": cada linha é uma ocorrência; a recorrência
 * gera as demais a partir da primeira.
 *
 * Os inputs são `datetime-local` lidos e escritos NO FUSO da publicação.
 */
export function SeletorDeHorarios({
  datas,
  onChange,
  recorrencia,
  onRecorrencia,
  fuso,
  disabled,
}: {
  /** Instantes ISO. */
  datas: string[];
  onChange: (datas: string[]) => void;
  recorrencia: RecorrenciaDaPublicacao;
  onRecorrencia: (r: RecorrenciaDaPublicacao) => void;
  fuso: string;
  disabled?: boolean;
}) {
  const t = useT();
  const ultima = datas[datas.length - 1] ?? null;

  function mudar(i: number, valor: string) {
    const iso = paredeParaInstante(valor, fuso);
    const proximo = [...datas];
    proximo[i] = iso ?? proximo[i]!;
    onChange(proximo);
  }
  function adicionar(dias: number) {
    if (datas.length >= MAXIMO_DE_DATAS_POR_PUBLICACAO) return;
    const base = ultima ?? new Date().toISOString();
    const nova = mesmaHoraOutroDia(base, dias, fuso);
    if (datas.includes(nova)) return;
    onChange([...datas, nova]);
  }
  function remover(i: number) {
    if (datas.length <= 1) return;
    onChange(datas.filter((_, j) => j !== i));
  }
  const setKind = (kind: TipoDeRecorrencia) => onRecorrencia({ ...recorrencia, kind, config: kind === "weekdays" ? { weekdays: recorrencia.config.weekdays ?? [1, 3, 5] } : kind === "none" ? {} : { interval: recorrencia.config.interval ?? 1 } });
  const descricao = descreverRecorrencia(recorrencia.kind, recorrencia.config);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {datas.map((iso, i) => (
          <div key={`${iso}-${i}`} className="flex items-center gap-2">
            <Label htmlFor={`horario-${i}`} className="w-16 shrink-0 text-xs text-muted-foreground">
              {i === 0 ? t("Primeira") : `${i + 1}ª`}
            </Label>
            <Input id={`horario-${i}`} type="datetime-local" value={instanteParaParede(iso, fuso)} onChange={(e) => mudar(i, e.target.value)} disabled={disabled} className="max-w-xs" data-testid={`horario-${i + 1}`} />
            {datas.length > 1 ? (
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Remover este horário")} onClick={() => remover(i)} disabled={disabled}>
                <Trash size={14} aria-hidden />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => adicionar(1)} disabled={disabled || datas.length >= MAXIMO_DE_DATAS_POR_PUBLICACAO}>
          <Plus size={14} aria-hidden />
          {t("Adicionar horário")}
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
        ) : null}
      </div>
    </div>
  );
}
