"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";

import { ConnectionsClient } from "./ConnectionsClient";
import { NovaConexaoDialog, type PainelDeConexao } from "./NovaConexaoDialog";
import { TemplatesClient } from "./TemplatesClient";
import { TemplatesParceiroClient } from "./TemplatesParceiroClient";

/**
 * Conexões — TODOS os canais numa lista só.
 *
 * ─── Por que uma lista, e não uma aba por tipo ─────────────────────────────
 * Decisão do dono (30/09). A tela tinha uma aba por forma de conectar (QR, API
 * oficial, parceiro, redes sociais, voz), e quem queria saber "o que está
 * conectado?" precisava abrir cinco abas. A pergunta que a tela responde é
 * "por onde meu negócio fala com o cliente" — a resposta é UMA lista, e
 * conectar é UM botão ("Adicionar conexão") que abre um popup com as opções.
 *
 * ─── Os links antigos continuam valendo ────────────────────────────────────
 * `?aba=oficial|parceiro|voz` abre o popup direto no formulário daquela forma;
 * `?sub=templates` abre os modelos. Redirects (`/app/settings/canal-oficial`,
 * `/app/settings/templates`), avisos da Central e links salvos apontam para
 * eles — quebrar isso transformaria todo link em "abre e procura".
 */
export function ConexoesShell({
  wahaConfigured,
  wacallsConfigured,
}: {
  wahaConfigured: boolean;
  wacallsConfigured: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();

  const [novaAberta, setNovaAberta] = useState(false);
  const [painelInicial, setPainelInicial] = useState<PainelDeConexao>("escolher");
  const [pedidoDeQr, setPedidoDeQr] = useState(0);
  const [modelos, setModelos] = useState<"oficial" | "parceiro" | null>(null);

  // Deep link e volta do OAuth: lidos uma vez, e a URL é limpa em seguida —
  // senão recarregar a página reabriria o popup ou repetiria o aviso.
  useEffect(() => {
    const aba = params.get("aba");
    const sub = params.get("sub");
    const conectado = params.get("conectado");
    const erro = params.get("erro");
    if (!aba && !conectado && !erro) return;

    if (conectado) {
      toast.success(t("Conta conectada. As mensagens novas já chegam no Atendimento."));
      void qc.invalidateQueries({ queryKey: ["channel-sessions"] });
    }
    if (erro) toast.error(t(erro));

    if (aba === "oficial" || aba === "parceiro") {
      if (sub === "templates") setModelos(aba);
      else {
        setPainelInicial(aba);
        setNovaAberta(true);
      }
    } else if (aba === "voz") {
      setPainelInicial("voz");
      setNovaAberta(true);
    }
    router.replace("/app/connections", { scroll: false });
  }, [params, router, t, qc]);

  const abrirNova = (painel: PainelDeConexao) => {
    setPainelInicial(painel);
    setNovaAberta(true);
  };

  return (
    <>
      <ConnectionsClient
        wahaConfigured={wahaConfigured}
        onAdicionar={() => abrirNova("escolher")}
        onConfigurar={(via) => abrirNova(via)}
        onModelos={(fonte) => setModelos(fonte)}
        pedidoDeQr={pedidoDeQr}
      />

      <NovaConexaoDialog
        open={novaAberta}
        onOpenChange={(aberto) => {
          setNovaAberta(aberto);
          // O formulário do popup pode ter conectado algo: a lista relê.
          if (!aberto) void qc.invalidateQueries({ queryKey: ["channel-sessions"] });
        }}
        painelInicial={painelInicial}
        wahaConfigured={wahaConfigured}
        wacallsConfigured={wacallsConfigured}
        onEscolherQr={() => setPedidoDeQr((n) => n + 1)}
      />

      {/* Modelos aprovados: só existem nas conexões de API oficial e do
          parceiro, e por isso abrem a partir do cartão delas. "Modelos do
          parceiro" / "Templates da Meta", e não "Templates": a barra lateral
          já tem um item com esse nome que é OUTRA coisa (respostas rápidas). */}
      <Dialog open={modelos !== null} onOpenChange={(aberto) => !aberto && setModelos(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{modelos === "parceiro" ? t("Modelos do parceiro") : t("Templates da Meta")}</DialogTitle>
          </DialogHeader>
          {modelos === "parceiro" && (
            <TemplatesParceiroClient />
          )}
          {modelos === "oficial" && <TemplatesClient />}
        </DialogContent>
      </Dialog>
    </>
  );
}
