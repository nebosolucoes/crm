"use client";

import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { CabecalhoDePublicacoes } from "@/components/publicacoes/Cabecalho";
import { ChannelIcon } from "@/components/publicacoes/ChannelIcon";
import { ROTULO_DA_REDE } from "@/components/publicacoes/rotulos";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { useInstrucoesDeLegenda, useSalvarInstrucaoDeLegenda } from "@/hooks/publicacoes/usePublicacoes";
import { MAXIMO_DA_INSTRUCAO, type InstrucaoDaRede } from "@/lib/publicacoes/legenda/instrucoes";

/**
 * Instruções de legenda: o "prompt prévio" de cada rede, que a IA segue quando
 * alguém clica em Sugerir legenda no Agendar. Uma por rede, para a organização
 * inteira; sem texto, vale o padrão do produto.
 */
export function InstrucoesClient({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const { data, isLoading } = useInstrucoesDeLegenda();
  return (
    <div className="flex h-full flex-col gap-6 p-6 pt-0">
      <CabecalhoDePublicacoes
        titulo={t("Instruções de legenda")}
        descricao={t("Como a IA deve escrever em cada rede quando você clica em Sugerir legenda no Agendar: tom, tamanho, emojis, hashtags, o que a marca nunca diz.")}
        podeEditar={podeEditar}
      />
      {isLoading || !data ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {data.map((instrucao) => (
            // A chave muda quando o servidor devolve outra versão: o cartão remonta com o texto novo.
            <CartaoDaRede key={`${instrucao.network}:${instrucao.updated_at ?? "padrao"}`} instrucao={instrucao} podeEditar={podeEditar} />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoDaRede({ instrucao, podeEditar }: { instrucao: InstrucaoDaRede; podeEditar: boolean }) {
  const t = useT();
  const salvar = useSalvarInstrucaoDeLegenda();
  const [texto, setTexto] = useState(instrucao.instructions);
  const mudou = texto.trim() !== instrucao.instructions.trim();
  const rede = instrucao.network;

  async function gravar(valor: string, mensagem: string) {
    try {
      await salvar.mutateAsync({ network: rede, instructions: valor });
      toast.success(mensagem);
    } catch (err) {
      showApiError(err);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby={`instrucao-${rede}`} data-testid={`instrucao-${rede}`}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={`instrucao-${rede}`} className="flex items-center gap-2 text-base font-semibold">
          <ChannelIcon channel={rede} format="feed" state="active" size={24} decorative />
          {ROTULO_DA_REDE[rede]}
        </h2>
        <span className="text-[11px] text-muted-foreground" data-testid={`instrucao-${rede}-origem`}>
          {instrucao.personalizada ? t("Personalizada") : t("Padrão do produto")}
        </span>
      </header>
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={10}
        maxLength={MAXIMO_DA_INSTRUCAO}
        disabled={!podeEditar || salvar.isPending}
        aria-label={`${t("Instrução de legenda")} — ${ROTULO_DA_REDE[rede]}`}
        data-testid={`instrucao-${rede}-texto`}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {texto.length}/{MAXIMO_DA_INSTRUCAO}
        </span>
        {podeEditar ? (
          <div className="flex gap-2">
            {instrucao.personalizada ? (
              <Button type="button" variant="ghost" size="sm" disabled={salvar.isPending} onClick={() => void gravar("", t("Instrução padrão restaurada."))} data-testid={`instrucao-${rede}-restaurar`}>
                {t("Restaurar padrão")}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={!mudou || salvar.isPending} onClick={() => void gravar(texto, t("Instrução salva."))} data-testid={`instrucao-${rede}-salvar`}>
              {salvar.isPending ? t("Salvando…") : t("Salvar")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
