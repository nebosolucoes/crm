/**
 * Webhook de erro DESTA INSTALAÇÃO (migration 0290, `platform_error_webhook`).
 *
 * Cada erro que `lib/api/registro-de-erro.ts` grava em `api_error_log` também
 * é enviado ao endereço configurado em Admin › Webhook de erro — tipicamente o
 * webhook de uma central de chamados, que abre um card por erro. O corpo segue
 * o formato da integração por webhook do Nebo Task (`titulo`, `descricao`,
 * `prioridade`, `id_externo`, `solicitante`, `campos`) e é assinado com
 * `X-Nebo-Assinatura: sha256=<HMAC-SHA256(segredo, corpo)>` quando há segredo.
 *
 * `id_externo` = o ID do erro (o mesmo que a tela mostra): reenviar não duplica.
 *
 * NUNCA LANÇA e nunca chama `fail()` — um erro ao avisar de um erro geraria
 * outro aviso. Falha de envio vira uma linha de log, e só.
 */
import { createHmac } from "node:crypto";

import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export type EscopoDoWebhookDeErro = "all" | "server";

interface WebhookEmVigor {
  readonly url: string;
  readonly segredo: string | null;
  readonly escopo: EscopoDoWebhookDeErro;
}

/** O erro, já com o que o registro resolveu (rota, usuário). */
export interface ErroParaAvisar {
  readonly requestId: string;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly method: string | null;
  readonly path: string | null;
  readonly details: unknown;
  readonly usuario: { id: string; email: string | null; nome: string | null } | null;
  readonly quando: Date;
}

const TTL_MS = 30_000;
/** Tempo máximo do envio: depois da resposta, mas sem prender o processo. */
const TEMPO_MAXIMO_MS = 8_000;
/**
 * Teto de envios por minuto, por processo. Uma rajada (banco fora do ar, por
 * exemplo) gera um erro por requisição; sem teto, viraria centenas de cards
 * idênticos em segundos. Os que passam do teto ficam em `api_error_log` e no log.
 */
export const TETO_POR_MINUTO = 60;

declare global {
  var __memoDoWebhookDeErro: { readonly valor: WebhookEmVigor | null; readonly expiraEm: number } | null | undefined;
  var __janelaDoWebhookDeErro: { inicio: number; enviados: number; pulados: number } | undefined;
}

export function invalidarWebhookDeErro(): void {
  globalThis.__memoDoWebhookDeErro = null;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Em produção vale a regra anti-SSRF do produto; fora dela, http e localhost servem para testar. */
export function enderecoPermitido(url: string, producao = process.env.NODE_ENV === "production"): boolean {
  try {
    if (producao) {
      assertSafeOutboundUrl(url);
      return new URL(url).protocol === "https:";
    }
    const p = new URL(url).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

async function lerDoBanco(): Promise<WebhookEmVigor | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("platform_error_webhook" as never)
      .select("enabled, url, secret_encrypted, scope")
      .eq("id", 1)
      .maybeSingle();
    if (error) return null;
    const linha = data as { enabled: boolean; url: string | null; secret_encrypted: string | null; scope: string } | null;
    if (!linha?.enabled) return null;
    const url = texto(linha.url);
    if (!url || !enderecoPermitido(url)) return null;
    let segredo: string | null = null;
    const cifrado = texto(linha.secret_encrypted);
    if (cifrado) {
      segredo = texto(await decryptWebhookSecret(admin, cifrado)) || null;
      if (!segredo) logger.warn("[webhook-de-erro] segredo não decifrou; envio vai sem assinatura");
    }
    return { url, segredo, escopo: linha.scope === "server" ? "server" : "all" };
  } catch {
    return null;
  }
}

async function webhookEmVigor(): Promise<WebhookEmVigor | null> {
  const memo = globalThis.__memoDoWebhookDeErro;
  if (memo && memo.expiraEm > Date.now()) return memo.valor;
  const valor = await lerDoBanco();
  globalThis.__memoDoWebhookDeErro = { valor, expiraEm: Date.now() + TTL_MS };
  return valor;
}

function cabeDentroDoTeto(agora = Date.now()): boolean {
  const j = (globalThis.__janelaDoWebhookDeErro ??= { inicio: agora, enviados: 0, pulados: 0 });
  if (agora - j.inicio >= 60_000) {
    if (j.pulados > 0) {
      logger.warn("[webhook-de-erro] envios pulados pelo teto por minuto", { pulados: j.pulados, teto: TETO_POR_MINUTO });
    }
    j.inicio = agora;
    j.enviados = 0;
    j.pulados = 0;
  }
  if (j.enviados >= TETO_POR_MINUTO) {
    j.pulados += 1;
    return false;
  }
  j.enviados += 1;
  return true;
}

/** O corpo no formato da integração por webhook do Nebo Task. Puro. */
export function corpoDoAviso(erro: ErroParaAvisar, instalacao: string | null): Record<string, unknown> {
  const rota = [erro.method, erro.path].filter(Boolean).join(" ") || "rota desconhecida";
  const detalhes =
    erro.details === undefined || erro.details === null ? null : JSON.stringify(erro.details).slice(0, 3000);
  const campos: Record<string, string> = {
    "ID do erro": erro.requestId,
    Status: String(erro.status),
    "Código": erro.code,
    Rota: rota,
    Quando: erro.quando.toISOString(),
  };
  if (instalacao) campos["Instalação"] = instalacao;
  if (erro.usuario) campos["Usuário (id)"] = erro.usuario.id;
  if (detalhes) campos.Detalhes = detalhes;
  return {
    titulo: `Erro ${erro.status} no CRM: ${erro.code} em ${rota}`.slice(0, 200),
    descricao: erro.message,
    prioridade: erro.status >= 500 ? "alta" : "media",
    id_externo: erro.requestId,
    ...(erro.usuario
      ? {
          solicitante: {
            ...(erro.usuario.nome ? { nome: erro.usuario.nome } : {}),
            ...(erro.usuario.email ? { email: erro.usuario.email } : {}),
          },
        }
      : {}),
    campos,
  };
}

export function assinatura(segredo: string, corpo: string): string {
  return `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
}

/** Resultado de uma entrega: `status` HTTP do destino, ou `falha` quando nem respondeu. */
export type ResultadoDaEntrega = { ok: boolean; status: number | null; falha?: string };

/** Uma entrega, sem regra de escopo nem teto — usada pelo aviso e pelo "Enviar teste". */
export async function entregar(
  destino: { url: string; segredo: string | null },
  erro: ErroParaAvisar,
): Promise<ResultadoDaEntrega> {
  try {
    if (!enderecoPermitido(destino.url)) return { ok: false, status: null, falha: "endereco_nao_permitido" };
    const instalacao = texto(process.env.NEXT_PUBLIC_APP_URL) || null;
    const corpo = JSON.stringify(corpoDoAviso(erro, instalacao));
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (destino.segredo) headers["X-Nebo-Assinatura"] = assinatura(destino.segredo, corpo);
    const r = await fetch(destino.url, {
      method: "POST",
      headers,
      body: corpo,
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
      redirect: "error",
    });
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, status: null, falha: err instanceof Error ? err.message : String(err) };
  }
}

/** A configuração gravada, ligada ou não — para o "Enviar teste" da tela. */
export async function webhookGravado(): Promise<{ url: string; segredo: string | null } | null> {
  invalidarWebhookDeErro();
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("platform_error_webhook" as never)
      .select("url, secret_encrypted")
      .eq("id", 1)
      .maybeSingle();
    const linha = data as { url: string | null; secret_encrypted: string | null } | null;
    const url = texto(linha?.url);
    if (!url) return null;
    const cifrado = texto(linha?.secret_encrypted);
    const segredo = cifrado ? texto(await decryptWebhookSecret(admin, cifrado)) || null : null;
    return { url, segredo };
  } catch {
    return null;
  }
}

/** Envia o aviso de um erro, se a instalação ligou o webhook. Nunca lança. */
export async function avisarErro(erro: ErroParaAvisar): Promise<void> {
  try {
    const webhook = await webhookEmVigor();
    if (!webhook) return;
    if (webhook.escopo === "server" && erro.status < 500) return;
    if (!cabeDentroDoTeto()) return;

    const r = await entregar(webhook, erro);
    if (!r.ok) {
      logger.warn("[webhook-de-erro] aviso não entregue", {
        requestId: erro.requestId,
        status: r.status,
        motivo: r.falha,
      });
    }
  } catch (err) {
    logger.warn("[webhook-de-erro] aviso não enviado", {
      requestId: erro.requestId,
      motivo: err instanceof Error ? err.message : String(err),
    });
  }
}
