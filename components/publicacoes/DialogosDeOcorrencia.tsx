"use client";

import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useMutacoesDePublicacao } from "@/hooks/publicacoes/usePublicacoes";
import { instanteParaParede, paredeParaInstante } from "@/lib/publicacoes/tempo-da-tela";

/**
 * Os diálogos de uma ocorrência. O corpo de cada um nasce com o estado
 * inicial (`key` por alvo): abrir de novo é montar de novo — sem efeito que
 * reinicia estado.
 */

/** Alterar só o horário DESTA ocorrência. As outras datas não mudam. */
export function DialogoDeReagendar({
  ocorrenciaId,
  scheduledAt,
  fuso,
  aberto,
  onFechar,
}: {
  ocorrenciaId: string | null;
  scheduledAt: string | null;
  fuso: string;
  aberto: boolean;
  onFechar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o ? onFechar() : null)}>
      <DialogContent className="sm:max-w-sm">
        {ocorrenciaId && scheduledAt ? <CorpoDoReagendar key={`${ocorrenciaId}:${scheduledAt}`} ocorrenciaId={ocorrenciaId} scheduledAt={scheduledAt} fuso={fuso} onFechar={onFechar} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CorpoDoReagendar({ ocorrenciaId, scheduledAt, fuso, onFechar }: { ocorrenciaId: string; scheduledAt: string; fuso: string; onFechar: () => void }) {
  const t = useT();
  const { reagendar } = useMutacoesDePublicacao();
  const [valor, setValor] = useState(() => instanteParaParede(scheduledAt, fuso));

  async function confirmar() {
    const iso = paredeParaInstante(valor, fuso);
    if (!iso) {
      toast.error(t("Escolha uma data e hora."));
      return;
    }
    try {
      await reagendar.mutateAsync({ id: ocorrenciaId, scheduled_at: iso });
      toast.success(t("Horário alterado."));
      onFechar();
    } catch (err) {
      showApiError(err);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("Alterar horário")}</DialogTitle>
        <DialogDescription>{t("Só esta ocorrência muda. As outras datas da publicação continuam como estão.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="novo-horario">{t("Nova data e hora")}</Label>
        <Input id="novo-horario" type="datetime-local" value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onFechar} disabled={reagendar.isPending}>
          {t("Voltar")}
        </Button>
        <Button onClick={() => void confirmar()} disabled={reagendar.isPending}>
          {reagendar.isPending ? t("Salvando…") : t("Salvar horário")}
        </Button>
      </DialogFooter>
    </>
  );
}

export type AlvoDeCancelamento = { tipo: "ocorrencia"; id: string } | { tipo: "publicacao"; id: string } | { tipo: "excluir"; id: string };

/** Cancelar uma ocorrência, ou a publicação inteira (com motivo), ou excluir. */
export function DialogoDeCancelar({ alvo, aberto, onFechar, onFeito }: { alvo: AlvoDeCancelamento | null; aberto: boolean; onFechar: () => void; onFeito?: () => void }) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o ? onFechar() : null)}>
      <DialogContent className="sm:max-w-sm">{alvo ? <CorpoDoCancelar key={`${alvo.tipo}:${alvo.id}`} alvo={alvo} onFechar={onFechar} onFeito={onFeito} /> : null}</DialogContent>
    </Dialog>
  );
}

function CorpoDoCancelar({ alvo, onFechar, onFeito }: { alvo: AlvoDeCancelamento; onFechar: () => void; onFeito?: () => void }) {
  const t = useT();
  const { cancelar, cancelarOcorrencia, excluir } = useMutacoesDePublicacao();
  const [motivo, setMotivo] = useState("");
  const ocupado = cancelar.isPending || cancelarOcorrencia.isPending || excluir.isPending;

  async function confirmar() {
    try {
      if (alvo.tipo === "ocorrencia") {
        await cancelarOcorrencia.mutateAsync(alvo.id);
        toast.success(t("Ocorrência cancelada."));
      } else if (alvo.tipo === "publicacao") {
        if (motivo.trim().length < 3) {
          toast.error(t("Escreva o motivo (pelo menos 3 letras)."));
          return;
        }
        await cancelar.mutateAsync({ id: alvo.id, reason: motivo.trim() });
        toast.success(t("Publicação cancelada."));
      } else {
        await excluir.mutateAsync(alvo.id);
        toast.success(t("Publicação excluída."));
      }
      onFeito?.();
      onFechar();
    } catch (err) {
      showApiError(err);
    }
  }

  const titulo = alvo.tipo === "ocorrencia" ? t("Cancelar esta ocorrência?") : alvo.tipo === "publicacao" ? t("Cancelar a publicação inteira?") : t("Excluir a publicação?");
  const descricao =
    alvo.tipo === "ocorrencia"
      ? t("Só esta data deixa de sair. As outras datas da publicação continuam agendadas.")
      : alvo.tipo === "publicacao"
        ? t("Nenhuma data pendente sai mais. O que já foi publicado fica no Histórico.")
        : t("A publicação some das telas e as datas pendentes são canceladas. O que já saiu fica no Histórico.");

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription>{descricao}</DialogDescription>
      </DialogHeader>
      {alvo.tipo === "publicacao" ? (
        <div className="grid gap-2">
          <Label htmlFor="motivo-cancelamento">{t("Motivo")}</Label>
          <Input id="motivo-cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={t("Ex.: a oferta acabou")} />
        </div>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={onFechar} disabled={ocupado}>
          {t("Voltar")}
        </Button>
        <Button variant={alvo.tipo === "excluir" ? "destructive" : "default"} onClick={() => void confirmar()} disabled={ocupado}>
          {ocupado ? t("Aguarde…") : alvo.tipo === "excluir" ? t("Excluir") : t("Confirmar cancelamento")}
        </Button>
      </DialogFooter>
    </>
  );
}
