"use client";

import { useMemo, useState, useTransition } from "react";

import { updateAiCostDisplay } from "@/app/actions/settings/updateAiCostDisplay";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import {
  COTACAO_MIN,
  MARGEM_MAX_PCT,
  formatarCusto,
  formatarCustoReal,
  type ExibicaoDoCusto,
} from "@/lib/ai/custo/moeda";

/** Uma execução típica, para a prévia: a chamada real medida em 2026-09-21 (US$ 0,0021). */
const EXEMPLO_EXECUCAO_USD_CENTS = 0.2093;
/** Um mês típico de uma organização pequena, para a prévia da soma. */
const EXEMPLO_MES_USD_CENTS = 1250;

/**
 * Botão "Salvar" explícito, ao contrário do interruptor de `/admin/cadastro`:
 * aqui são três campos que só fazem sentido juntos (ligar real sem cotação é
 * um estado recusado pelo banco), e a prévia ao lado mostra o efeito ANTES de
 * gravar — quem digita 54 em vez de 5,4 vê "R$ 11,30" numa execução de
 * fração de centavo e corrige antes que o cliente veja.
 */
export function FormularioDeCustoDeIa({ inicial }: { inicial: ExibicaoDoCusto }) {
  const t = useT();
  const [emReal, setEmReal] = useState(inicial.moeda === "BRL");
  const [cotacao, setCotacao] = useState<string>(
    inicial.cotacao !== null ? String(inicial.cotacao).replace(".", ",") : "",
  );
  const [margem, setMargem] = useState<string>(String(inicial.margemPct).replace(".", ","));
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pendente, startTransition] = useTransition();

  const cotacaoNum = Number(cotacao.trim().replace(",", "."));
  const margemNum = margem.trim() === "" ? 0 : Number(margem.trim().replace(",", "."));
  const cotacaoValida = !emReal || (Number.isFinite(cotacaoNum) && cotacaoNum >= COTACAO_MIN);
  const margemValida = Number.isFinite(margemNum) && margemNum >= 0 && margemNum <= MARGEM_MAX_PCT;

  const previa: ExibicaoDoCusto | null = useMemo(() => {
    if (!cotacaoValida || !margemValida) return null;
    return {
      moeda: emReal ? "BRL" : "USD",
      cotacao: emReal ? cotacaoNum : null,
      margemPct: margemNum,
    };
  }, [emReal, cotacaoNum, margemNum, cotacaoValida, margemValida]);

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (previa === null) return;
    setErro(null);
    setSalvo(false);
    startTransition(async () => {
      const r = await updateAiCostDisplay(previa);
      if (!r.ok) {
        setErro(
          r.error === "invalid_input"
            ? t("Confira a cotação e a margem: a cotação precisa ser maior que zero para mostrar em real.")
            : t("Não deu para salvar. Tente de novo em instantes."),
        );
        return;
      }
      setSalvo(true);
    });
  }

  return (
    <form onSubmit={salvar} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <CardTitle>{t("Moeda do custo de IA")}</CardTitle>
          <CardDescription>
            {t(
              "O provedor de IA cobra em dólar, e é em dólar que o sistema guarda cada gasto. Aqui você escolhe como esse gasto é MOSTRADO às empresas: em dólar, ou em real por uma cotação fixa que você define — com a margem que quiser embutir.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="em-real" className="text-base">
                {t("Mostrar em real (R$)")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {emReal
                  ? t("Ligado: Uso, Execuções, Evolução, o limite de orçamento e os avisos falam em R$ pela cotação abaixo.")
                  : t("Desligado: tudo em US$, como o provedor cobra.")}
              </p>
            </div>
            <Switch
              id="em-real"
              checked={emReal}
              onCheckedChange={(v) => {
                setEmReal(v);
                setSalvo(false);
              }}
              disabled={pendente}
              aria-label={t("Mostrar em real (R$)")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cotacao">{t("Cotação do dólar (R$ por US$ 1)")}</Label>
              <Input
                id="cotacao"
                inputMode="decimal"
                placeholder="5,40"
                value={cotacao}
                onChange={(e) => {
                  setCotacao(e.target.value);
                  setSalvo(false);
                }}
                disabled={!emReal || pendente}
                aria-invalid={!cotacaoValida}
              />
              <p className="text-xs text-muted-foreground">
                {t("Fixa: o sistema não busca câmbio. Atualize quando quiser; o histórico passa a ser lido pela cotação nova.")}
              </p>
              {!cotacaoValida && (
                <p className="text-xs text-destructive">{t("Para mostrar em real, a cotação precisa ser maior que zero.")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="margem">{t("Margem sobre o custo (%)")}</Label>
              <Input
                id="margem"
                inputMode="decimal"
                placeholder="0"
                value={margem}
                onChange={(e) => {
                  setMargem(e.target.value);
                  setSalvo(false);
                }}
                disabled={pendente}
                aria-invalid={!margemValida}
              />
              <p className="text-xs text-muted-foreground">
                {t("0 = só converter. As empresas veem o valor COM margem; você, aqui no admin, vê também o custo real.")}
              </p>
              {!margemValida && (
                <p className="text-xs text-destructive">
                  {t("A margem vai de 0 a")} {MARGEM_MAX_PCT}%.
                </p>
              )}
            </div>
          </div>

          {erro && (
            <p className="text-sm text-destructive" role="alert">
              {erro}
            </p>
          )}
          {salvo && !erro && (
            <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
              {t("Salvo. As telas passam a usar a nova moeda no próximo carregamento.")}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={pendente || previa === null}>
              {pendente ? t("Salvando…") : t("Salvar")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="previa-do-custo">
        <CardHeader>
          <CardTitle className="text-base">{t("Como vai aparecer")}</CardTitle>
          <CardDescription>{t("Dois exemplos reais, com o que você digitou acima.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Exemplo
            rotulo={t("Uma execução do agente")}
            real={formatarCustoReal(EXEMPLO_EXECUCAO_USD_CENTS, { casas: 4 })}
            exibido={previa ? formatarCusto(EXEMPLO_EXECUCAO_USD_CENTS, previa, { casas: 4 }) : "—"}
          />
          <Exemplo
            rotulo={t("Um mês de uma empresa pequena")}
            real={formatarCustoReal(EXEMPLO_MES_USD_CENTS)}
            exibido={previa ? formatarCusto(EXEMPLO_MES_USD_CENTS, previa) : "—"}
          />
          <p className="text-xs text-muted-foreground">
            {t("O que muda é a leitura: o sistema continua guardando cada gasto em dólar, e o limite de orçamento continua sendo comparado nessa mesma régua.")}
          </p>
        </CardContent>
      </Card>
    </form>
  );
}

function Exemplo({ rotulo, real, exibido }: { rotulo: string; real: string; exibido: string }) {
  const t = useT();
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{exibido}</p>
      <p className="text-xs text-muted-foreground">
        {t("custo real")}: {real}
      </p>
    </div>
  );
}
