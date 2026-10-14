"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Conversation } from "@/lib/types/messaging";

interface CloseArgs {
  conversation_id: string;
  expected_revision?: number;
  /** Spec 22: por que um comentário fecha sem resposta. */
  motivo?: "sem_resposta_necessaria" | "spam" | "ocultado";
}

/**
 * FECHAR RESPONDE NA HORA — a conversa sai da lista no clique, não no fim da ida
 * e volta.
 *
 * Antes o clique só desabilitava o botão: a lista esperava o POST (sessão,
 * papel, recurso, RPC) e DEPOIS o refetch de todas as listas abertas, e só
 * então a conversa saía. Com o banco em outro continente, isso eram segundos
 * de tela parada — o "está muito demorado para fechar" relatado em 14/10.
 *
 * Agora o cache é ajustado antes: a conversa some das listas que não mostram
 * fechadas (todas, menos a aba Fechadas) e o cabeçalho já mostra "Fechada".
 * Falhou (409, rede)? Restaura o retrato e relê — o servidor é quem vale.
 */
type ListaEmCache = { pages: { data: Conversation[] }[]; pageParams: unknown[] };

function listaMostraFechadas(chave: readonly unknown[]): boolean {
  const filtros = chave[1] as { status?: string | readonly string[] } | undefined;
  const status = filtros?.status;
  if (!status) return false;
  return (typeof status === "string" ? [status] : status).includes("closed");
}

export function useCloseConversation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: CloseArgs) =>
      apiClient.post<{ data: Conversation }>(
        `/api/v1/conversations/${args.conversation_id}/close`,
        { expected_revision: args.expected_revision, ...(args.motivo ? { motivo: args.motivo } : {}) },
      ),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["conversations"] });
      await qc.cancelQueries({ queryKey: ["conversation", args.conversation_id] });
      const listas = qc.getQueriesData<ListaEmCache>({ queryKey: ["conversations"] });
      const detalhe = qc.getQueryData<Conversation>(["conversation", args.conversation_id]);
      for (const [chave, dados] of listas) {
        if (!dados?.pages) continue;
        const mostra = listaMostraFechadas(chave);
        qc.setQueryData<ListaEmCache>(chave, {
          ...dados,
          pages: dados.pages.map((p) => ({
            ...p,
            data: mostra
              ? p.data.map((c) => (c.id === args.conversation_id ? { ...c, status: "closed" } : c))
              : p.data.filter((c) => c.id !== args.conversation_id),
          })),
        });
      }
      if (detalhe) {
        qc.setQueryData<Conversation>(["conversation", args.conversation_id], { ...detalhe, status: "closed" });
      }
      return { listas, detalhe };
    },
    onError: (err, args, ctx) => {
      for (const [chave, dados] of ctx?.listas ?? []) qc.setQueryData(chave, dados);
      if (ctx?.detalhe) qc.setQueryData(["conversation", args.conversation_id], ctx.detalhe);
      showApiError(err);
    },
    onSettled: (_data, _err, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversation-counts"] });
    },
  });
}

/**
 * ARQUIVAR (#923) — tira a conversa do fluxo vivo sem destruir nada.
 *
 * Vai pelo mesmo PATCH versionado da reabertura, com `status: "archived"`: quem
 * aplica é a `fn_service_status`, com o lock otimista de sempre. Não existe rota
 * nova porque arquivar NÃO é um efeito colateral — é a mesma transição de status
 * que a API já aceita, e uma rota dedicada só criaria um segundo caminho para o
 * mesmo UPDATE.
 */
export function useArchiveConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CloseArgs) => apiClient.patch<{ data: Conversation }>(
      `/api/v1/conversations/${args.conversation_id}`,
      { status: "archived", expected_revision: args.expected_revision },
    ),
    // `onSettled`, e não `onSuccess`: mesmo no 409 (alguém mexeu na conversa
    // entre a leitura e este clique) a tela precisa reler — é o estado do
    // servidor que vale, não o que estava no cache.
    onError: showApiError,
    onSettled: (_data, _error, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}

/** Reabertura explícita preserva as proteções de automação do contato. */
export function useReopenConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CloseArgs) => apiClient.patch<{ data: Conversation }>(
      `/api/v1/conversations/${args.conversation_id}`,
      { status: "open", expected_revision: args.expected_revision },
    ),
    onError: showApiError,
    onSettled: (_data, _error, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}

/**
 * Oculta o comentário na rede e fecha o atendimento (spec 22 §5.1). Sem
 * `message_id`, oculta o comentário principal do fio.
 */
export function useHideComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { conversation_id: string; message_id?: string }) =>
      apiClient.post<{ data: { hidden: boolean } }>(
        `/api/v1/conversations/${args.conversation_id}/hide-comment`,
        args.message_id ? { message_id: args.message_id } : {},
      ),
    onError: (err) => showApiError(err),
    onSettled: (_d, _e, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}
