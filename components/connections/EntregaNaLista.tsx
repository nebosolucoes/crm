"use client";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import type { ChannelSession } from "@/hooks/channels/useChannelSessions";
import { apiClient } from "@/lib/api/client";
import type { PlataformaSocial } from "@/lib/channels/plataformas";
import { CaretDown, CaretUp } from "@/lib/ui/icons";

import { EscolhaDaEntrega, type Entrega } from "./EscolhaDaEntrega";

/**
 * "O que entra na inbox" no cartão de uma conexão de Instagram/Facebook
 * (spec 22 §4). Fechado mostra o resumo; aberto, a mesma escolha do popup de
 * conectar. Cada mudança salva na hora — é um interruptor, não um formulário.
 */
export function EntregaNaLista({
  canal,
  plataforma,
  onSalvo,
}: {
  canal: ChannelSession;
  plataforma: PlataformaSocial;
  onSalvo: () => void;
}) {
  const t = useT();
  const atual: Entrega = { direct: canal.inbox_direct !== false, comentarios: canal.inbox_comments === true };
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState<Entrega>(atual);
  const [salvando, setSalvando] = useState(false);

  const resumo =
    atual.direct && atual.comentarios
      ? t("Mensagens e comentários")
      : atual.comentarios
        ? t("Só comentários")
        : t("Só mensagens");

  const salvar = async (proximo: Entrega) => {
    const anterior = valor;
    setValor(proximo);
    setSalvando(true);
    try {
      const r = await apiClient.patch<{ data: { provedor_atualizado: boolean } }>(
        `/api/v1/channel-sessions/${canal.id}/inbox`,
        { inbox_direct: proximo.direct, inbox_comments: proximo.comentarios },
      );
      toast.success(
        r.data.provedor_atualizado
          ? t("Pronto — a caixa de atendimento já recebe o que você escolheu.")
          : t("Salvo. O provedor não confirmou a mudança, mas o que foi desligado já não entra na caixa."),
      );
      onSalvo();
    } catch (e) {
      setValor(anterior);
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível salvar a escolha."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="entrega-na-lista">
      <Button
        variant="ghost"
        size="sm"
        className="-mx-2 h-7 justify-between px-2 text-xs font-normal"
        onClick={() => {
          setValor(atual);
          setAberto((a) => !a);
        }}
        aria-expanded={aberto}
      >
        <span>
          <span className="text-muted-foreground">{t("Entra na inbox:")}</span> {resumo}
        </span>
        {aberto ? <CaretUp size={12} aria-hidden /> : <CaretDown size={12} aria-hidden />}
      </Button>
      {aberto && (
        <EscolhaDaEntrega plataforma={plataforma} valor={valor} onChange={(p) => void salvar(p)} desabilitado={salvando} />
      )}
    </div>
  );
}
