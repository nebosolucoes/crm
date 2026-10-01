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
 * O que um atendimento de COMENTÁRIO mostra a mais no cabeçalho (spec 22 §7):
 * em que publicação foi, se é anúncio, e o link para abrir na rede. A pessoa
 * responde em público — precisa ver o post antes de escrever.
 */
export function ContextoDoComentario({ metadata, conta }: { metadata: unknown; conta: string | null }) {
  const t = useT();
  const c = lerContextoDoComentario(metadata);
  return (
    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground" data-testid="contexto-do-comentario">
      {c.imagemDoPost && (
        // CDN da Meta, que expira: sem otimização do Next (que guardaria o link morto).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.imagemDoPost} alt="" className="size-8 shrink-0 rounded-md object-cover" loading="lazy" />
      )}
      <span className="min-w-0 truncate">
        {t("Comentário em")} {conta ?? t("publicação")}
        {c.textoDoPost ? ` · ${c.textoDoPost}` : ""}
      </span>
      {c.ehAnuncio && (
        <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
          {t("Anúncio")}
        </Badge>
      )}
      {c.permalink && (
        <a
          href={c.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-accent hover:underline"
        >
          {t("Ver publicação")}
          <ArrowSquareOut size={11} aria-hidden />
        </a>
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
