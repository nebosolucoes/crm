/**
 * GET /api/v1/channels/social/callback — a volta do OAuth do Instagram /
 * Messenger. Grava a conexão e registra o webhook; o operador não cola nada.
 *
 * ─── Por que esta rota não usa `requireRole` ───────────────────────────────
 *
 * A volta vem do Facebook (navegação entre sites), e o cookie de sessão é
 * `SameSite=Strict`: ele NÃO vem junto. A autorização é refeita com o que o
 * `state` assinado garante — organização, usuário e sessão de login —, contra
 * o banco: o modo de suporte somente leitura (`supportCallbackWriteAllowed`)
 * e o papel de admin (`atorAindaPodeConectar`). O `accountId` da query não é
 * confiado: `concluirConexaoSocial` o confere no provedor, restrito ao
 * profile que ESTA tentativa criou.
 *
 * Todo desfecho volta para a tela de Conexões — nunca um JSON cru na cara de
 * quem acabou de sair do Facebook.
 */
import { NextResponse, type NextRequest } from "next/server";

import { NOME_DO_VINCULO, vinculoConfere } from "@/lib/agenda/google/vinculo";
import { audit } from "@/lib/audit";
import {
  atorAindaPodeConectar,
  CAMINHO_DO_CALLBACK_SOCIAL,
  concluirConexaoSocial,
  explicarErroDoCallback,
} from "@/lib/channels/social";
import { conferirEstadoSocial } from "@/lib/channels/social-state";
import { urlDoWebhookDoCanal, urlPublicaDaInstalacao } from "@/lib/channels/url-publica";
import { limiteDeConexaoAtingido } from "@/lib/entitlements/exigir-na-rota";
import { env } from "@/lib/env";
import { supportCallbackWriteAllowed } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function voltar(req: NextRequest, q: Record<string, string>): NextResponse {
  const destino = new URL(`${urlPublicaDaInstalacao(req)}/app/connections`);
  destino.searchParams.set("aba", "social");
  for (const [k, v] of Object.entries(q)) destino.searchParams.set(k, v);
  const resposta = NextResponse.redirect(destino);
  // Toda saída passa por aqui — sucesso e erro —, então o vínculo morre com a
  // tentativa em vez de viver até o TTL.
  resposta.cookies.set(NOME_DO_VINCULO, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_CALLBACK_SOCIAL,
    maxAge: 0,
  });
  return resposta;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams;
  const estado = conferirEstadoSocial(q.get("state"));
  if (!estado || !vinculoConfere(req.cookies.get(NOME_DO_VINCULO)?.value, estado.nonce, env.INTERNAL_SECRET)) {
    // Mesma resposta para os dois: distinguir diria a quem ataca que o `state`
    // que ele tem é legítimo e só falta o navegador certo.
    return voltar(req, { erro: "A conexão expirou ou não foi iniciada neste navegador. Tente de novo." });
  }

  const falhou = async (motivo: string, detalhe: Record<string, unknown>): Promise<NextResponse> => {
    await audit({
      action: "channel.connect_failed",
      actorUserId: estado.userId,
      actorAuthSessionId: estado.authSessionId,
      organizationId: estado.orgId,
      resourceType: "channel_sessions",
      metadata: { platform: estado.plataforma, ...detalhe },
    });
    return voltar(req, { erro: motivo });
  };

  // `error` primeiro: a doc do provedor manda conferi-lo antes de qualquer
  // outro parâmetro.
  const erro = q.get("error");
  if (erro) {
    return falhou(explicarErroDoCallback(erro, q.get("error_reason") ?? q.get("reason")), {
      reason: "provider_error",
      provider_error: erro.slice(0, 80),
    });
  }

  const accountId = q.get("accountId");
  if (!accountId) return falhou("O provedor não informou a conta conectada. Tente de novo.", { reason: "missing_account" });

  const admin = createAdminClient();
  if (!(await supportCallbackWriteAllowed(estado.orgId, estado.userId, estado.authSessionId))) {
    return falhou("Esta sessão de suporte não pode conectar canais.", { reason: "support_readonly" });
  }
  if (!(await atorAindaPodeConectar(admin, estado))) {
    return falhou("Só quem administra a organização pode conectar canais.", { reason: "not_admin" });
  }
  // O teto foi conferido ao começar, mas dez minutos numa tela do Facebook dão
  // tempo de outra pessoa ocupar a última vaga.
  const noTeto = await limiteDeConexaoAtingido(admin, estado.orgId, estado.plataforma);
  if (noTeto) return falhou(noTeto, { reason: "limit_reached" });

  const r = await concluirConexaoSocial(admin, {
    estado,
    accountId,
    urlDoWebhook: (token) => urlDoWebhookDoCanal(req, token),
  });
  if (!r.ok) return falhou(r.motivo, { reason: "conclude_failed" });

  await audit({
    action: "channel.connected",
    actorUserId: estado.userId,
    actorAuthSessionId: estado.authSessionId,
    organizationId: estado.orgId,
    resourceType: "channel_sessions",
    resourceId: r.valor.sessionId,
    metadata: { platform: r.valor.plataforma },
  });

  return voltar(req, { conectado: r.valor.plataforma });
}
