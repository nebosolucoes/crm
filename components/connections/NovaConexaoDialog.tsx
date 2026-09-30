"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { IconeDaPlataforma } from "@/components/channels/IconeDaPlataforma";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { PlataformaSocial } from "@/lib/channels/plataformas";
import { PARTNER_CHANNEL_LABEL } from "@/lib/channels/rotulos";
import { ArrowLeft, CircleNotch, PhoneOutgoing, QrCode, ShieldCheck } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { CanalOficialClient } from "./CanalOficialClient";
import { CanalParceiroClient } from "./CanalParceiroClient";
import { CanalVozClient } from "./CanalVozClient";

/**
 * "Adicionar conexão" — o único ponto de entrada para conectar qualquer canal.
 *
 * Decisão do dono (30/09): a tela de Conexões deixou de ter uma aba por tipo
 * de canal. É uma lista só, e este popup reúne TODAS as formas de conectar,
 * agrupadas pelo que o operador reconhece (WhatsApp, Redes sociais, Voz).
 *
 * As formas que têm formulário próprio (API oficial, parceiro, voz) abrem o
 * MESMO componente de antes, dentro do popup — não há segundo formulário para
 * divergir do primeiro. As que não têm (QR, Instagram, Messenger) partem direto:
 * o QR abre o diálogo de pareamento; Instagram e Messenger vão para a Meta.
 */
export type PainelDeConexao = "escolher" | "oficial" | "parceiro" | "voz";

interface EstadoSocial {
  configured: boolean;
  env_var: string;
}

export function NovaConexaoDialog({
  open,
  onOpenChange,
  painelInicial = "escolher",
  wahaConfigured,
  wacallsConfigured,
  onEscolherQr,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  painelInicial?: PainelDeConexao;
  wahaConfigured: boolean;
  wacallsConfigured: boolean;
  /** Parear por QR mora na lista (o diálogo do QR é dela). */
  onEscolherQr: () => void;
}) {
  const t = useT();
  const [painel, setPainel] = useState<PainelDeConexao>(painelInicial);
  const [indoPara, setIndoPara] = useState<PlataformaSocial | null>(null);

  // Reabrir o popup volta ao painel pedido (um link `?aba=oficial` abre direto
  // no formulário da API oficial; o botão abre na escolha).
  useEffect(() => {
    if (open) setPainel(painelInicial);
  }, [open, painelInicial]);

  const social = useQuery({
    queryKey: ["channels-social"],
    queryFn: () => apiClient.get<{ data: EstadoSocial }>("/api/v1/channels/social").then((r) => r.data),
    enabled: open,
  });
  const socialPronto = social.data?.configured ?? false;

  const conectarSocial = async (plataforma: PlataformaSocial) => {
    setIndoPara(plataforma);
    try {
      const r = await apiClient.post<{ data: { auth_url: string } }>("/api/v1/channels/social/connect", { platform: plataforma });
      // Navegação de verdade: a tela seguinte é a da Meta.
      window.location.assign(r.data.auth_url);
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível iniciar a conexão."));
      setIndoPara(null);
    }
  };

  const titulo =
    painel === "oficial"
      ? t("WhatsApp · API oficial da Meta")
      : painel === "parceiro"
        ? `WhatsApp · ${PARTNER_CHANNEL_LABEL}`
        : painel === "voz"
          ? t("Chamada de voz")
          : t("Adicionar conexão");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="nova-conexao">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {painel !== "escolher" && (
              <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={() => setPainel("escolher")}>
                <ArrowLeft size={14} aria-hidden />
                {t("Voltar")}
              </Button>
            )}
            {titulo}
          </DialogTitle>
          {painel === "escolher" && (
            <DialogDescription>
              {t("Escolha por onde seus clientes vão falar com você. Dá para ter mais de uma conta de cada, dentro do limite do seu plano.")}
            </DialogDescription>
          )}
        </DialogHeader>

        {painel === "escolher" && (
          <div className="flex flex-col gap-5">
            <Grupo titulo="WhatsApp">
              <Opcao
                icone={<QrCode size={20} aria-hidden />}
                nome={t("WhatsApp por QR code")}
                descricao={t("Escaneie com o celular do número. Rápido, sem aprovação da Meta.")}
                indisponivel={!wahaConfigured ? t("O serviço de WhatsApp por QR não está configurado nesta instalação.") : null}
                onClick={() => {
                  onOpenChange(false);
                  onEscolherQr();
                }}
              />
              <Opcao
                icone={<ShieldCheck size={20} aria-hidden />}
                nome={t("WhatsApp API oficial (Meta)")}
                descricao={t("Número oficial da sua conta na Meta, com modelos aprovados.")}
                onClick={() => setPainel("oficial")}
              />
              <Opcao
                icone={<IconeDaPlataforma plataforma="whatsapp" className="size-5" titulo={false} />}
                nome={`WhatsApp · ${PARTNER_CHANNEL_LABEL}`}
                descricao={t("Número oficial conectado pelo provedor parceiro.")}
                onClick={() => setPainel("parceiro")}
              />
            </Grupo>

            <Grupo titulo={t("Redes sociais")}>
              {(["instagram", "messenger"] as const).map((rede) => (
                <Opcao
                  key={rede}
                  icone={
                    indoPara === rede ? (
                      <CircleNotch size={20} className="animate-spin" aria-hidden />
                    ) : (
                      <IconeDaPlataforma plataforma={rede} className="size-5" titulo={false} />
                    )
                  }
                  nome={rede === "instagram" ? t("Instagram Direct") : t("Facebook Messenger")}
                  descricao={
                    rede === "instagram"
                      ? t("Mensagens diretas de uma conta profissional do Instagram.")
                      : t("Mensagens da página do Facebook.")
                  }
                  indisponivel={
                    social.isLoading
                      ? null
                      : !socialPronto
                        ? `${t("Não configurado nesta instalação — falta")} ${social.data?.env_var ?? ""} ${t("no .env.")}`
                        : null
                  }
                  ocupado={indoPara !== null}
                  onClick={() => void conectarSocial(rede)}
                />
              ))}
            </Grupo>

            <Grupo titulo={t("Voz")}>
              <Opcao
                icone={<PhoneOutgoing size={20} aria-hidden />}
                nome={t("Chamada de voz")}
                descricao={t("Ligar e receber chamadas de WhatsApp pelo CRM.")}
                onClick={() => setPainel("voz")}
              />
            </Grupo>
          </div>
        )}

        {painel === "oficial" && <CanalOficialClient />}
        {painel === "parceiro" && <CanalParceiroClient />}
        {painel === "voz" && <CanalVozClient wacallsConfigured={wacallsConfigured} />}
      </DialogContent>
    </Dialog>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Opcao({
  icone,
  nome,
  descricao,
  indisponivel = null,
  ocupado = false,
  onClick,
}: {
  icone: React.ReactNode;
  nome: string;
  descricao: string;
  /** Motivo de estar desligada — aparece no lugar da descrição. */
  indisponivel?: string | null;
  ocupado?: boolean;
  onClick: () => void;
}) {
  const desligada = indisponivel !== null || ocupado;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desligada}
      data-opcao-de-conexao={nome}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors",
        desligada ? "cursor-not-allowed opacity-60" : "hover:border-accent hover:bg-surface-elevated",
      )}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icone}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{nome}</span>
        <span className="block text-xs text-muted-foreground">{indisponivel ?? descricao}</span>
      </span>
    </button>
  );
}
