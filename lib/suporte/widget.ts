/**
 * O widget de suporte DESTA INSTALAÇÃO (migration 0289, `platform_support_widget`).
 *
 * Um `<script>` de uma central de chamados externa, carregado em toda tela
 * logada, com a identidade de quem está logado assinada por HMAC-SHA256 do id do
 * usuário com o segredo do widget. O segredo é cifrado no banco e só é decifrado
 * aqui, no servidor: ao navegador chega o hash, nunca o segredo.
 *
 * NUNCA LANÇA. Roda no layout de `/app`, e um throw ali é 500 em todas as telas.
 * Qualquer falha (tabela ausente num banco sem a 0289, cifra indisponível) vira
 * "sem widget" e um log.
 */
import { createHmac } from "node:crypto";

import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

/** O que o layout entrega ao componente do navegador. Sem segredo nenhum. */
export interface WidgetDeSuporteNaTela {
  readonly scriptUrl: string;
  readonly publicKey: string;
  readonly identidade: {
    readonly id: string;
    readonly nome: string | null;
    readonly email: string;
    readonly empresa: string | null;
    readonly hash: string | null;
  };
}

interface WidgetEmVigor {
  readonly scriptUrl: string;
  readonly publicKey: string;
  readonly segredo: string | null;
}

/** Memo de processo, mesmo motivo e TTL de `lib/channels/meta/app.ts`. */
const TTL_MS = 30_000;

declare global {
  var __memoDoWidgetDeSuporte: { readonly valor: WidgetEmVigor | null; readonly expiraEm: number } | null | undefined;
}

/** Chamada pela server action que grava a configuração. */
export function invalidarWidgetDeSuporte(): void {
  globalThis.__memoDoWidgetDeSuporte = null;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** HMAC-SHA256 hex do id — o formato que a central de chamados confere. */
export function hashDaIdentidade(segredo: string, userId: string): string {
  return createHmac("sha256", segredo).update(String(userId)).digest("hex");
}

async function lerDoBanco(): Promise<WidgetEmVigor | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("platform_support_widget" as never)
      .select("enabled, script_url, public_key, hmac_secret_encrypted")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      logger.info("[suporte.widget] sem configuração legível; widget desligado", { codigo: error.code });
      return null;
    }
    const linha = data as {
      enabled: boolean;
      script_url: string | null;
      public_key: string | null;
      hmac_secret_encrypted: string | null;
    } | null;
    if (!linha?.enabled) return null;
    const scriptUrl = texto(linha.script_url);
    const publicKey = texto(linha.public_key);
    if (!scriptUrl || !publicKey) return null;

    let segredo: string | null = null;
    const cifrado = texto(linha.hmac_secret_encrypted);
    if (cifrado) {
      segredo = texto(await decryptWebhookSecret(admin, cifrado)) || null;
      if (!segredo) {
        // Sem hash a central aceita o chamado como "não verificado"; o botão
        // continua útil, e o motivo fica no log em vez de sumir com o widget.
        logger.warn("[suporte.widget] segredo não decifrou; identidade vai sem verificação");
      }
    }
    return { scriptUrl, publicKey, segredo };
  } catch (err) {
    logger.warn("[suporte.widget] leitura falhou; widget desligado", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function widgetEmVigor(): Promise<WidgetEmVigor | null> {
  const memo = globalThis.__memoDoWidgetDeSuporte;
  if (memo && memo.expiraEm > Date.now()) return memo.valor;
  const valor = await lerDoBanco();
  globalThis.__memoDoWidgetDeSuporte = { valor, expiraEm: Date.now() + TTL_MS };
  return valor;
}

/**
 * O widget para ESTE usuário, ou `null` quando a instalação não o ligou.
 * `empresa` é a organização ativa — o cliente desta instalação.
 */
export async function widgetDeSuporteParaTela(usuario: {
  id: string;
  email: string;
  full_name: string | null;
}, empresa: string | null): Promise<WidgetDeSuporteNaTela | null> {
  const widget = await widgetEmVigor();
  if (!widget) return null;
  return {
    scriptUrl: widget.scriptUrl,
    publicKey: widget.publicKey,
    identidade: {
      id: usuario.id,
      nome: usuario.full_name,
      email: usuario.email,
      empresa,
      hash: widget.segredo ? hashDaIdentidade(widget.segredo, usuario.id) : null,
    },
  };
}
