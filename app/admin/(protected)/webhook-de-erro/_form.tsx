"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  testarWebhookDeErro,
  updateWebhookDeErro,
  type UpdateWebhookDeErroResult,
} from "@/app/actions/settings/updateWebhookDeErro";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  readonly ligado: boolean;
  readonly url: string;
  readonly escopo: "all" | "server";
  /** SE existe segredo gravado — nunca QUAL. */
  readonly temSegredoSalvo: boolean;
  readonly leituraFalhou: boolean;
}

export function FormularioDoWebhookDeErro({
  ligado: ligadoInicial,
  url: urlInicial,
  escopo: escopoInicial,
  temSegredoSalvo,
  leituraFalhou,
}: Props) {
  const t = useT();
  const router = useRouter();
  const [ligado, setLigado] = useState(ligadoInicial);
  const [url, setUrl] = useState(urlInicial);
  const [escopo, setEscopo] = useState<"all" | "server">(escopoInicial);
  const [segredo, setSegredo] = useState("");
  const [ocupado, iniciar] = useTransition();

  function motivoDaRecusa(r: Extract<UpdateWebhookDeErroResult, { ok: false }>): string {
    switch (r.error) {
      case "invalid_input":
        return t("Confira os campos e tente de novo.");
      case "url_obrigatoria":
        return t("Para ligar o envio, preencha o endereço do webhook.");
      case "url_nao_permitida":
        return t("Este endereço não é aceito. Use o link https do webhook da central de chamados.");
      default:
        return `${t("Não deu para salvar, e nada foi gravado.")} ${t(r.error)}`;
    }
  }

  function salvar(extra: { remover_segredo?: boolean } = {}) {
    iniciar(async () => {
      const r = await updateWebhookDeErro({
        enabled: ligado,
        url: url.trim(),
        scope: escopo,
        secret: segredo.trim() || undefined,
        ...extra,
      });
      if (!r.ok) {
        toast.error(motivoDaRecusa(r));
        return;
      }
      setSegredo("");
      toast.success(t("Webhook de erro salvo."));
      router.refresh();
    });
  }

  function testar() {
    iniciar(async () => {
      const r = await testarWebhookDeErro();
      if (r.ok) {
        toast.success(`${t("Erro de teste enviado: a central respondeu")} ${r.status}. ${t("Confira o card novo no quadro.")}`);
        return;
      }
      if (r.error === "nada_gravado") {
        toast.error(t("Salve o endereço do webhook antes de testar."));
        return;
      }
      toast.error(
        r.status
          ? `${t("A central recusou o teste com o status")} ${r.status}. ${t("Confira o endereço e o segredo.")}`
          : `${t("Não deu para falar com a central.")} ${t(r.error)}`,
      );
    });
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Webhook de erro")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Cada erro que o sistema apresentar é enviado para este endereço — por exemplo, o webhook da central de chamados, que abre um card novo para cada erro. O ID do erro, o mesmo que aparece na tela, vai junto: reenviar não duplica o card.")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" data-testid="webhook-erro-testar" disabled={ocupado} onClick={testar}>
            {t("Enviar teste")}
          </Button>
          <Button data-testid="webhook-erro-salvar" disabled={ocupado} onClick={() => salvar()}>
            {ocupado ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      </header>

      {leituraFalhou ? (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning-bg p-3 text-xs leading-4 text-text-muted"
        >
          {t("Não deu para ler a configuração salva agora, então o que aparece abaixo pode não ser o que está valendo. Recarregue a página antes de trocar qualquer coisa.")}
        </p>
      ) : null}

      <Card className="flex flex-col gap-5 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="webhook-erro-ligado">{t("Enviar os erros")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("Desligado, os erros continuam gravados no sistema, mas nada é enviado.")}
            </p>
          </div>
          <Switch
            id="webhook-erro-ligado"
            data-testid="webhook-erro-ligado"
            checked={ligado}
            onCheckedChange={setLigado}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-erro-url">{t("Endereço do webhook")}</Label>
          <Input
            id="webhook-erro-url"
            data-testid="webhook-erro-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://.../api/integracoes/..."
            autoComplete="off"
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            {t("Na central de chamados: Configuração › Integrações › webhook › Link. Quem tem este endereço consegue abrir cards, então trate-o como senha.")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-erro-segredo">{t("Segredo da assinatura")}</Label>
          <Input
            id="webhook-erro-segredo"
            data-testid="webhook-erro-segredo"
            type="password"
            autoComplete="off"
            value={segredo}
            onChange={(e) => setSegredo(e.target.value)}
            placeholder={temSegredoSalvo ? t("••••••••  (já cadastrado)") : t("Cole o segredo da integração")}
          />
          <p className="text-xs text-muted-foreground">
            {temSegredoSalvo
              ? t("Já existe um segredo cadastrado. Deixe em branco para mantê-lo, ou cole um novo para substituir.")
              : t("Opcional, recomendado. Cada envio é assinado com ele, e a central recusa o que não vier assinado se “Exigir assinatura” estiver ligado lá. É guardado cifrado.")}
          </p>
          {temSegredoSalvo ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                data-testid="webhook-erro-remover-segredo"
                disabled={ocupado}
                onClick={() => salvar({ remover_segredo: true })}
              >
                {t("Remover segredo")}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("Quais erros enviar")}</Label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="webhook-erro-escopo"
              data-testid="webhook-erro-escopo-all"
              checked={escopo === "all"}
              onChange={() => setEscopo("all")}
              className="mt-1"
            />
            <span>
              {t("Todos os erros")}
              <span className="block text-xs text-muted-foreground">
                {t("Inclusive os do dia a dia, como formulário com campo inválido ou sessão expirada. Um card para cada um.")}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="webhook-erro-escopo"
              data-testid="webhook-erro-escopo-server"
              checked={escopo === "server"}
              onChange={() => setEscopo("server")}
              className="mt-1"
            />
            <span>
              {t("Só falhas do sistema")}
              <span className="block text-xs text-muted-foreground">
                {t("Erros 500 e telas que quebraram — o que costuma ser defeito de verdade.")}
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            {t("Proteção contra enxurrada: no máximo 60 envios por minuto. Os que passarem disso continuam gravados no sistema.")}
          </p>
        </div>
      </Card>
    </div>
  );
}
