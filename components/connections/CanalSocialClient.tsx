"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { IconeDaPlataforma } from "@/components/channels/IconeDaPlataforma";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { PlataformaSocial } from "@/lib/channels/plataformas";

import { ChannelAiAccess } from "./ChannelAiAccess";

/**
 * Instagram Direct e Messenger — a aba "Redes sociais" de Conexões (spec 21).
 *
 * Dois passos, na ordem em que dão errado:
 *
 *   1. A CHAVE do provedor, uma vez por organização. É validada contra ele
 *      antes de gravar — inclusive se a conta dele tem a caixa de entrada
 *      liberada, que é o que falha calado.
 *   2. CONECTAR: o botão manda para a tela de autorização da Meta e volta para
 *      cá já conectado. O webhook é registrado pelo CRM; ao contrário da aba
 *      do parceiro, não há nada para colar.
 *
 * O nome do provedor vem do servidor (`label`) pelo mesmo motivo da aba do
 * parceiro: a tela não pode nomear provider (`lint:channels`).
 */

interface Conexao {
  id: string;
  platform: PlataformaSocial;
  platform_label: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  status: string | null;
  created_at: string;
}

interface Estado {
  label: string;
  has_api_key: boolean;
  connections: Conexao[];
}

export function CanalSocialClient() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [trocandoChave, setTrocandoChave] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [conectando, setConectando] = useState<PlataformaSocial | null>(null);

  const carregar = async () => {
    try {
      const r = await apiClient.get<{ data: Estado }>("/api/v1/channels/social");
      setEstado(r.data);
    } catch {
      setEstado(null);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  // A volta do OAuth chega com `?conectado=` ou `?erro=`. Vira aviso e sai da
  // URL — senão recarregar a página repetiria o aviso de uma conexão antiga.
  useEffect(() => {
    const conectado = params.get("conectado");
    const erro = params.get("erro");
    if (!conectado && !erro) return;
    if (conectado) toast.success(t("Conta conectada. As mensagens novas já chegam no Atendimento."));
    if (erro) toast.error(t(erro));
    router.replace("/app/connections?aba=social", { scroll: false });
  }, [params, router, t]);

  const salvarChave = async () => {
    setSalvando(true);
    try {
      await apiClient.post("/api/v1/channels/social/key", { api_key: apiKey });
      setApiKey("");
      setTrocandoChave(false);
      toast.success(t("Chave verificada e gravada."));
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível gravar a chave."));
    } finally {
      setSalvando(false);
    }
  };

  const conectar = async (plataforma: PlataformaSocial) => {
    setConectando(plataforma);
    try {
      const r = await apiClient.post<{ data: { auth_url: string } }>("/api/v1/channels/social/connect", {
        platform: plataforma,
      });
      // Navegação de verdade, não `router.push`: a tela seguinte é da Meta.
      window.location.assign(r.data.auth_url);
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível iniciar a conexão."));
      setConectando(null);
    }
  };

  const remover = async (id: string) => {
    try {
      await apiClient.delete(`/api/v1/channel-sessions/${id}`);
      toast.success(t("Conexão removida."));
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível remover a conexão."));
    }
  };

  const rotulo = estado?.label ?? t("provedor parceiro");
  const temChave = estado?.has_api_key ?? false;
  const pedirChave = !temChave || trocandoChave;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <IconeDaPlataforma plataforma="instagram" titulo={false} />
              <IconeDaPlataforma plataforma="messenger" titulo={false} />
              {t("Instagram Direct e Messenger")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "As mensagens diretas do Instagram e da página do Facebook entram no Atendimento junto com o WhatsApp — com o mesmo robô, as mesmas filas e os mesmos setores.",
              )}
            </p>
          </div>
          {temChave ? (
            <Badge variant="secondary">{t("Chave cadastrada")}</Badge>
          ) : (
            <Badge variant="outline">{t("Sem chave")}</Badge>
          )}
        </div>

        {pedirChave ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="social-chave">
                {t("Chave de API")} · {rotulo}
              </Label>
              <Input
                id="social-chave"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t("cole a chave")}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "É a chave da sua conta no provedor, no painel dele em Configurações › API Keys. Guardada cifrada; depois de gravada ela não é mostrada de novo.",
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={salvarChave} disabled={salvando || apiKey.trim().length < 8}>
                {salvando ? t("Verificando…") : t("Gravar chave")}
              </Button>
              {trocandoChave && (
                <Button variant="ghost" onClick={() => setTrocandoChave(false)}>
                  {t("Cancelar")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => conectar("instagram")} disabled={conectando !== null} className="gap-2">
                <IconeDaPlataforma plataforma="instagram" titulo={false} />
                {conectando === "instagram" ? t("Abrindo…") : t("Conectar Instagram")}
              </Button>
              <Button
                onClick={() => conectar("messenger")}
                disabled={conectando !== null}
                variant="outline"
                className="gap-2"
              >
                <IconeDaPlataforma plataforma="messenger" titulo={false} />
                {conectando === "messenger" ? t("Abrindo…") : t("Conectar Messenger")}
              </Button>
              <Button variant="ghost" onClick={() => setTrocandoChave(true)}>
                {t("Trocar chave")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "Você vai para a tela de autorização da Meta e volta para cá já conectado. O Instagram precisa ser uma conta profissional (comercial ou criador).",
              )}
            </p>
          </div>
        )}
      </Card>

      {(estado?.connections ?? []).map((c) => (
        <Card key={c.id} className="flex flex-col gap-3 p-4" data-conexao-social={c.platform}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {c.avatar_url ? (
                // Avatar vem do CDN da Meta; `img` simples porque o domínio não
                // é fixo e o `next/image` exigiria configurá-lo por instalação.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatar_url} alt="" className="size-9 rounded-full object-cover" />
              ) : (
                <IconeDaPlataforma plataforma={c.platform} className="size-9" />
              )}
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <IconeDaPlataforma plataforma={c.platform} titulo={false} />
                  {c.display_name ?? c.platform_label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.platform_label}
                  {c.username ? ` · @${c.username}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.status === "WORKING" ? (
                <Badge variant="secondary">{t("Conectado")}</Badge>
              ) : (
                <Badge variant="destructive">{t("Reconectar")}</Badge>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost">
                    {t("Remover")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("Remover esta conexão?")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t(
                        "As mensagens novas deixam de chegar ao CRM. O histórico das conversas continua guardado.",
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void remover(c.id)}>{t("Remover")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <ChannelAiAccess channelId={c.id} />
        </Card>
      ))}
    </div>
  );
}
