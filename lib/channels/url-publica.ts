import type { NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Endereço público desta instalação — o que um provedor externo usa para
 * chamar de volta (webhook, retorno do OAuth).
 *
 * `env.*` e NÃO `process.env.NEXT_PUBLIC_APP_URL` direto: variáveis
 * `NEXT_PUBLIC_` são substituídas no BUILD, e a imagem genérica do self-host é
 * construída com `https://placeholder.invalid` (Dockerfile). Lendo direto do
 * `process.env`, a tela mostrava essa URL — e quem a colasse no provedor
 * apontaria o webhook para o nada, sem nenhum erro em lugar nenhum. `env.*`
 * parseia em runtime, então a imagem serve qualquer domínio.
 *
 * O host da requisição é o fallback: numa instalação que esqueceu a variável,
 * o endereço por onde a tela está sendo servida é a melhor pista que existe —
 * e melhor que um placeholder que não resolve.
 */
export function urlPublicaDaInstalacao(req: NextRequest): string {
  const configurada = env.NEXT_PUBLIC_APP_URL;
  const usavel = configurada && !configurada.includes("placeholder.invalid") ? configurada : null;
  return (usavel ?? req.headers.get("origin") ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`).replace(
    /\/+$/,
    "",
  );
}

/** Onde um canal por credencial recebe o webhook do provedor. */
export function urlDoWebhookDoCanal(req: NextRequest, token: string): string {
  return `${urlPublicaDaInstalacao(req)}/api/v1/webhooks/channel/${token}`;
}

/**
 * A internet consegue chamar este endereço?
 *
 * Um provedor externo (o intermediário das redes sociais) entrega o webhook
 * pela internet. Registrar `localhost`, `192.168.x.x` ou um `.local` faz a
 * conexão "dar certo" na tela e nenhuma mensagem chegar nunca — medido em
 * 29/09: o provedor tentou entregar duas DMs em `http://192.168.4.158:3001` e
 * recebeu 403 nas duas, enquanto o CRM mostrava "Conectado".
 *
 * Julga só o que dá para saber sem rede: nome e faixa de IP. Um domínio
 * público atrás de firewall passa aqui e falha lá — mas o erro comum, o de
 * quem testa na própria máquina, é pego antes de mandar a pessoa para a Meta.
 */
export function alcancavelPelaInternet(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (!host.includes(".") && !host.includes(":")) return false; // nome de máquina sem domínio
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    return true;
  }
  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  }
  return true;
}
