"use client";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHideComment, useCloseConversation } from "@/hooks/inbox/useCloseConversation";
import { useT } from "@/hooks/i18n/useT";
import { lerContextoDoComentario } from "@/lib/channels/comentarios/contexto";
import { ArrowSquareOut } from "@/lib/ui/icons";

/**
 * A linha de identidade de um atendimento de COMENTÁRIO (spec 22 §7): em que
 * conta foi e se é anúncio. O post em si (miniatura, legenda, link) mora em
 * `PostDoComentario`, ao lado dos botões.
 */
export function ContextoDoComentario({ metadata, conta }: { metadata: unknown; conta: string | null }) {
  const t = useT();
  const c = lerContextoDoComentario(metadata);
  return (
    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground" data-testid="contexto-do-comentario">
      <span className="min-w-0 truncate">
        {t("Comentário em")} {conta ?? t("publicação")}
      </span>
      {c.ehAnuncio && (
        <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
          {t("Anúncio")}
        </Badge>
      )}
    </div>
  );
}

/**
 * O post onde o comentário foi feito, à direita do cabeçalho, antes dos botões
 * (pedido do dono, 01/10): miniatura grande, legenda em até 3 linhas com
 * reticências, e "Ver publicação" embaixo. Clicar na miniatura abre a imagem
 * grande num popup — quem responde em público precisa ver o que o cliente viu.
 */
export function PostDoComentario({ metadata }: { metadata: unknown }) {
  const t = useT();
  const c = lerContextoDoComentario(metadata);
  const [ampliada, setAmpliada] = useState(false);
  if (!c.imagemDoPost && !c.textoDoPost && !c.permalink) return null;

  return (
    <div className="ml-auto flex min-w-0 items-start gap-3" data-testid="post-do-comentario">
      {c.imagemDoPost && (
        <button
          type="button"
          onClick={() => setAmpliada(true)}
          className="shrink-0 overflow-hidden rounded-md border border-border transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          aria-label={t("Ver a imagem da publicação")}
          data-testid="miniatura-do-post"
        >
          {/* CDN da Meta, que expira: sem otimização do Next (que guardaria o link morto). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.imagemDoPost} alt="" className="size-16 object-cover" loading="lazy" />
        </button>
      )}
      <div className="flex min-w-0 max-w-[260px] flex-col gap-1">
        {c.textoDoPost && (
          <p
            className="line-clamp-3 whitespace-pre-line break-words text-xs text-text"
            title={c.textoDoPost}
            data-testid="legenda-do-post"
          >
            {c.textoDoPost}
          </p>
        )}
        {c.permalink && (
          <a
            href={c.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs text-accent hover:underline"
          >
            {t("Ver publicação")}
            <ArrowSquareOut size={11} aria-hidden />
          </a>
        )}
      </div>

      {c.imagemDoPost && (
        <Dialog open={ampliada} onOpenChange={setAmpliada}>
          <DialogContent className="sm:max-w-3xl" data-testid="imagem-do-post-ampliada">
            <DialogHeader>
              <DialogTitle>{t("Publicação")}</DialogTitle>
              {c.textoDoPost && (
                <DialogDescription className="line-clamp-2">{c.textoDoPost}</DialogDescription>
              )}
            </DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.imagemDoPost} alt="" className="max-h-[75vh] w-full rounded-md object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

const MOTIVOS = [
  { valor: "sem_resposta_necessaria", rotulo: "Não precisa de resposta", descricao: "Um elogio, uma marcação de amigo, um emoji." },
  { valor: "spam", rotulo: "Spam", descricao: "Propaganda, golpe ou comentário sem relação com a conta." },
] as const;

/**
 * Fechar e ocultar. Comentário ainda sem resposta só fecha com o motivo —
 * é o que garante que "fechado" nunca quer dizer "esquecido".
 */
export function AcoesDoComentario({
  conversationId,
  revisao,
  respondido,
}: {
  conversationId: string;
  revisao: number | undefined;
  respondido: boolean;
}) {
  const t = useT();
  const close = useCloseConversation();
  const hide = useHideComment();
  const [escolhendo, setEscolhendo] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={hide.isPending}
        data-testid="ocultar-comentario"
        onClick={() => {
          if (confirm(t("Ocultar este comentário na rede? Só quem comentou e a sua conta continuam vendo."))) {
            hide.mutate({ conversation_id: conversationId });
          }
        }}
      >
        {t("Ocultar")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={close.isPending}
        data-testid="fechar-comentario"
        onClick={() => {
          if (respondido) {
            if (confirm(t("Fechar este comentário?"))) close.mutate({ conversation_id: conversationId, expected_revision: revisao });
          } else {
            setEscolhendo(true);
          }
        }}
      >
        {t("Fechar")}
      </Button>
      <Dialog open={escolhendo} onOpenChange={setEscolhendo}>
        <DialogContent className="sm:max-w-md" data-testid="motivo-do-fechamento">
          <DialogHeader>
            <DialogTitle>{t("Fechar sem responder?")}</DialogTitle>
            <DialogDescription>
              {t("Este comentário ainda não tem resposta. Diga por que ele pode fechar assim.")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {MOTIVOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                className="rounded-lg border border-border p-3 text-left transition-colors hover:border-accent hover:bg-surface-elevated"
                disabled={close.isPending}
                onClick={() => {
                  close.mutate(
                    { conversation_id: conversationId, expected_revision: revisao, motivo: m.valor },
                    { onSuccess: () => setEscolhendo(false) },
                  );
                }}
              >
                <span className="block text-sm font-medium">{t(m.rotulo)}</span>
                <span className="block text-xs text-muted-foreground">{t(m.descricao)}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
