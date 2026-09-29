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
