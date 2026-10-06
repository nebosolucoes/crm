"use client";

import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { CabecalhoDePublicacoes } from "@/components/publicacoes/Cabecalho";
import { ChannelIcon } from "@/components/publicacoes/ChannelIcon";
import { ROTULO_DA_REDE } from "@/components/publicacoes/rotulos";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { useContasPublicaveis, useMutacoesDePrompt, usePromptsDeLegenda } from "@/hooks/publicacoes/usePublicacoes";
import { MAXIMO_DA_INSTRUCAO, MAXIMO_DO_NOME, type PromptDeLegenda } from "@/lib/publicacoes/legenda/instrucoes";
import { REDES_DA_PUBLICACAO } from "@/lib/publicacoes/schema";
import type { ContaPublicavel } from "@/lib/publicacoes/servico";
import { Plus } from "@/lib/ui/icons";

/**
 * Prompts de legenda: o jeito de escrever de cada MARCA, ligado às contas que o
 * usam (migration 0286). O Instagram e o Facebook da mesma empresa dividem um
 * prompt; dois perfis de empresas diferentes têm cada um o seu. Uma conta usa
 * um prompt só — marcá-la aqui a tira do prompt onde estava. Conta sem prompt
 * usa o padrão da rede dela, mostrado no fim da tela.
 */
export function PromptsClient({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const { data, isLoading } = usePromptsDeLegenda();
  const { data: contas, isLoading: carregandoContas } = useContasPublicaveis();
  const [novo, setNovo] = useState(false);

  const donoDaConta = new Map<string, PromptDeLegenda>();
  for (const p of data?.prompts ?? []) for (const c of p.channel_session_ids) donoDaConta.set(c, p);
  const semPrompt = (contas ?? []).filter((c) => !donoDaConta.has(c.id));

  return (
    <div className="flex h-full flex-col gap-6 p-6 pt-0">
      <CabecalhoDePublicacoes
        titulo={t("Prompts de legenda")}
        descricao={t("Como a IA deve escrever quando você clica em Sugerir legenda no Agendar. Cada prompt vale para as contas que você marcar nele — o Instagram e o Facebook da mesma empresa podem usar o mesmo.")}
        podeEditar={podeEditar}
        acao={
          podeEditar ? (
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setNovo(true)} disabled={novo} data-testid="novo-prompt">
              <Plus size={14} aria-hidden />
              {t("Novo prompt")}
            </Button>
          ) : null
        }
      />

      {isLoading || carregandoContas || !data ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-80 w-full" />
          ))}
        </div>
      ) : (
        <>
          {data.prompts.length === 0 && !novo ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" data-testid="prompts-vazio">
              {t("Nenhum prompt ainda. Todas as contas usam o padrão da rede delas (abaixo). Crie um prompt para dar à IA o jeito de escrever da sua marca.")}
            </div>
          ) : null}
          <div className="grid gap-4 xl:grid-cols-2">
            {novo ? <CartaoDoPrompt prompt={null} contas={contas ?? []} donoDaConta={donoDaConta} podeEditar={podeEditar} onFechar={() => setNovo(false)} /> : null}
            {data.prompts.map((p) => (
              // A chave muda quando o servidor devolve outra versão: o cartão remonta com o que foi salvo.
              <CartaoDoPrompt key={`${p.id}:${p.updated_at}:${p.channel_session_ids.join(",")}`} prompt={p} contas={contas ?? []} donoDaConta={donoDaConta} podeEditar={podeEditar} />
            ))}
          </div>

          <section className="flex flex-col gap-3" aria-labelledby="padroes" data-testid="padroes-das-redes">
            <div>
              <h2 id="padroes" className="text-base font-semibold">
                {t("Padrão do produto")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {semPrompt.length === 0
                  ? t("Todas as contas têm prompt. O padrão só vale para conta nova.")
                  : `${t("Contas sem prompt usam o padrão da rede delas:")} ${semPrompt.map((c) => nomeDaConta(c)).join(", ")}.`}
              </p>
            </div>
            <div className="grid gap-3 xl:grid-cols-3">
              {REDES_DA_PUBLICACAO.map((rede) => (
                <div key={rede} className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                    <ChannelIcon channel={rede} format="feed" state="active" size={18} decorative />
                    {ROTULO_DA_REDE[rede]}
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">{data.padroes[rede]}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function nomeDaConta(c: ContaPublicavel): string {
  return c.display_name ?? c.username ?? ROTULO_DA_REDE[c.network];
}

function CartaoDoPrompt({
  prompt,
  contas,
  donoDaConta,
  podeEditar,
  onFechar,
}: {
  prompt: PromptDeLegenda | null;
  contas: readonly ContaPublicavel[];
  donoDaConta: Map<string, PromptDeLegenda>;
  podeEditar: boolean;
  onFechar?: () => void;
}) {
  const t = useT();
  const { criar, alterar, excluir } = useMutacoesDePrompt();
  const [nome, setNome] = useState(prompt?.name ?? "");
  const [texto, setTexto] = useState(prompt?.instructions ?? "");
  const [marcadas, setMarcadas] = useState<string[]>(prompt?.channel_session_ids ?? []);
  const ocupado = criar.isPending || alterar.isPending || excluir.isPending;
  const chave = prompt?.id ?? "novo";

  const mesmasContas = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const mudou = !prompt || nome.trim() !== prompt.name || texto.trim() !== prompt.instructions || !mesmasContas(marcadas, prompt.channel_session_ids);
  const valido = nome.trim().length > 0 && texto.trim().length > 0;

  function alternar(id: string) {
    setMarcadas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function salvar() {
    try {
      const entrada = { name: nome.trim(), instructions: texto.trim(), channel_session_ids: marcadas };
      if (prompt) await alterar.mutateAsync({ id: prompt.id, ...entrada });
      else {
        await criar.mutateAsync(entrada);
        onFechar?.();
      }
      toast.success(t("Prompt salvo."));
    } catch (err) {
      showApiError(err);
    }
  }

  async function apagar() {
    if (!prompt) return;
    try {
      await excluir.mutateAsync(prompt.id);
      toast.success(t("Prompt apagado. As contas dele voltaram ao padrão da rede."));
    } catch (err) {
      showApiError(err);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-label={nome || t("Novo prompt")} data-testid={`prompt-${chave}`}>
      <div className="grid gap-1.5">
        <Label htmlFor={`prompt-${chave}-nome`}>{t("Nome")}</Label>
        <Input
          id={`prompt-${chave}-nome`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={t("Ex.: Padaria Müller")}
          maxLength={MAXIMO_DO_NOME}
          disabled={!podeEditar || ocupado}
          data-testid={`prompt-${chave}-nome`}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`prompt-${chave}-texto`}>{t("Como a IA deve escrever")}</Label>
        <Textarea
          id={`prompt-${chave}-texto`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={8}
          maxLength={MAXIMO_DA_INSTRUCAO}
          placeholder={t("Tom, tamanho, emojis, hashtags, o que a marca nunca diz…")}
          disabled={!podeEditar || ocupado}
          data-testid={`prompt-${chave}-texto`}
        />
        <span className="text-right text-[11px] text-muted-foreground">
          {texto.length}/{MAXIMO_DA_INSTRUCAO}
        </span>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("Contas que usam este prompt")}</legend>
        {contas.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("Nenhuma conta conectada para publicar. Conecte em Conexões.")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {contas.map((c) => {
              const marcada = marcadas.includes(c.id);
              const dono = donoDaConta.get(c.id);
              const deOutro = !marcada && dono && dono.id !== prompt?.id ? dono : null;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="checkbox"
                  aria-checked={marcada}
                  disabled={!podeEditar || ocupado}
                  onClick={() => alternar(c.id)}
                  className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${marcada ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}
                  title={deOutro ? `${t("Hoje usa o prompt")} “${deOutro.name}”. ${t("Marcar aqui move a conta para este.")}` : undefined}
                  data-testid={`prompt-${chave}-conta-${c.id}`}
                >
                  <ChannelIcon channel={c.network} format="feed" state={marcada ? "active" : "inactive"} size={18} decorative />
                  <span>{nomeDaConta(c)}</span>
                  {deOutro ? <span className="text-[10px] italic">· {deOutro.name}</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>
      {podeEditar ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          {prompt ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={ocupado} data-testid={`prompt-${chave}-apagar`}>
                  {t("Apagar")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("Apagar este prompt?")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("As contas dele passam a usar o padrão da rede. As publicações já agendadas não mudam.")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void apagar()} data-testid={`prompt-${chave}-apagar-confirmar`}>
                    {t("Apagar")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={onFechar} disabled={ocupado}>
              {t("Cancelar")}
            </Button>
          )}
          <Button type="button" size="sm" disabled={!mudou || !valido || ocupado} onClick={() => void salvar()} data-testid={`prompt-${chave}-salvar`}>
            {ocupado ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
