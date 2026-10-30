"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  updateWidgetDeSuporte,
  type UpdateWidgetDeSuporteResult,
} from "@/app/actions/settings/updateWidgetDeSuporte";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { enderecoEhSeguro, lerCodigoDeInstalacao } from "@/lib/suporte/codigo-de-instalacao";

interface Props {
  readonly ligado: boolean;
  readonly scriptUrl: string;
  readonly chavePublica: string;
  /** SE existe segredo gravado — nunca QUAL. */
  readonly temSegredoSalvo: boolean;
  readonly leituraFalhou: boolean;
}

export function FormularioDoWidgetDeSuporte({
  ligado: ligadoInicial,
  scriptUrl: scriptUrlInicial,
  chavePublica: chavePublicaInicial,
  temSegredoSalvo,
  leituraFalhou,
}: Props) {
  const t = useT();
  const router = useRouter();
  const [ligado, setLigado] = useState(ligadoInicial);
  const [scriptUrl, setScriptUrl] = useState(scriptUrlInicial);
  const [chavePublica, setChavePublica] = useState(chavePublicaInicial);
  const [segredo, setSegredo] = useState("");
  const [codigo, setCodigo] = useState("");
  /** O que a leitura do código colado conseguiu tirar — a tela diz, não adivinha. */
  const [leituraDoCodigo, setLeituraDoCodigo] = useState<"ok" | "nada" | null>(null);

  function aoColarCodigo(valor: string) {
    setCodigo(valor);
    if (!valor.trim()) {
      setLeituraDoCodigo(null);
      return;
    }
    const lido = lerCodigoDeInstalacao(valor);
    if (lido.scriptUrl) setScriptUrl(lido.scriptUrl);
    if (lido.publicKey) setChavePublica(lido.publicKey);
    setLeituraDoCodigo(lido.scriptUrl || lido.publicKey ? "ok" : "nada");
  }

  const enderecoInseguro = scriptUrl.trim() !== "" && !enderecoEhSeguro(scriptUrl);
  const [ocupado, iniciar] = useTransition();

  function motivoDaRecusa(r: Extract<UpdateWidgetDeSuporteResult, { ok: false }>): string {
    switch (r.error) {
      case "invalid_input":
        return t("Confira os campos: o endereço do script precisa começar com https://.");
      case "campos_obrigatorios":
        return t("Para ligar o botão, preencha o endereço do script e a chave pública.");
      default:
        return `${t("Não deu para salvar, e nada foi gravado.")} ${t(r.error)}`;
    }
  }

  function salvar(extra: { remover_segredo?: boolean } = {}) {
    iniciar(async () => {
      const r = await updateWidgetDeSuporte({
        enabled: ligado,
        script_url: scriptUrl.trim(),
        public_key: chavePublica.trim(),
        hmac_secret: segredo.trim() || undefined,
        ...extra,
      });
      if (!r.ok) {
        toast.error(motivoDaRecusa(r));
        return;
      }
      setSegredo("");
      toast.success(t("Widget de suporte salvo. Ele aparece nas telas em até 30 segundos."));
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Widget de suporte")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Um botão de suporte em todas as telas, para quem usa o sistema abrir e acompanhar chamados. Vale para a instalação inteira, e quem está logado é identificado automaticamente.")}
          </p>
        </div>
        <Button data-testid="suporte-salvar" disabled={ocupado} onClick={() => salvar()}>
          {ocupado ? t("Salvando…") : t("Salvar")}
        </Button>
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
            <Label htmlFor="suporte-ligado">{t("Mostrar o botão de suporte")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("Desligado, o botão some de todas as telas na hora.")}
            </p>
          </div>
          <Switch
            id="suporte-ligado"
            data-testid="suporte-ligado"
            checked={ligado}
            onCheckedChange={setLigado}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="suporte-codigo">{t("Código para instalar")}</Label>
          <Textarea
            id="suporte-codigo"
            data-testid="suporte-codigo"
            value={codigo}
            onChange={(e) => aoColarCodigo(e.target.value)}
            placeholder={'<script src="https://.../widget.js" data-key="pk_..." async></script>'}
            rows={5}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground" data-testid="suporte-codigo-estado">
            {leituraDoCodigo === "ok"
              ? t("Pronto: o endereço e a chave pública foram preenchidos abaixo. Confira e salve.")
              : leituraDoCodigo === "nada"
                ? t("Não encontrei o script nesse texto. Copie o código inteiro da tela do widget na central de chamados.")
                : t("Cole aqui o código inteiro da tela do widget na central de chamados. O endereço e a chave são preenchidos sozinhos; a identificação de quem está logado o sistema faz por conta própria.")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="suporte-script">{t("Endereço do script")}</Label>
          <Input
            id="suporte-script"
            data-testid="suporte-script"
            value={scriptUrl}
            onChange={(e) => setScriptUrl(e.target.value)}
            placeholder="https://.../widget.js"
            autoComplete="off"
          />
          {enderecoInseguro ? (
            <p role="alert" className="text-xs text-destructive" data-testid="suporte-endereco-inseguro">
              {t("O endereço precisa começar com https://. Um script http:// é bloqueado pelo navegador nas telas do sistema — use o endereço publicado da central, não o de teste local.")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("É o endereço que aparece no src do código de instalação do widget.")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="suporte-chave">{t("Chave pública")}</Label>
          <Input
            id="suporte-chave"
            data-testid="suporte-chave"
            value={chavePublica}
            onChange={(e) => setChavePublica(e.target.value)}
            placeholder="pk_..."
            autoComplete="off"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            {t("É o valor de data-key no código de instalação do widget.")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="suporte-segredo">{t("Segredo de verificação (HMAC)")}</Label>
          <Input
            id="suporte-segredo"
            data-testid="suporte-segredo"
            type="password"
            autoComplete="off"
            value={segredo}
            onChange={(e) => setSegredo(e.target.value)}
            placeholder={temSegredoSalvo ? t("••••••••  (já cadastrado)") : t("Cole o segredo do widget")}
          />
          <p className="text-xs text-muted-foreground">
            {temSegredoSalvo
              ? t("Já existe um segredo cadastrado. Deixe em branco para mantê-lo, ou cole um novo para substituir.")
              : t("Fica na central de chamados, em Widget de suporte › Segurança. Com ele, cada pessoa vê só os próprios chamados. É guardado cifrado e nunca volta a aparecer nesta tela.")}
          </p>
          {temSegredoSalvo ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                data-testid="suporte-remover-segredo"
                disabled={ocupado}
                onClick={() => salvar({ remover_segredo: true })}
              >
                {t("Remover segredo")}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
