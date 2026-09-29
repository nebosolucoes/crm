/**
 * POST /api/v1/channels/social/connect — começa a conexão de um Instagram ou
 * de uma página do Messenger. Devolve para onde mandar o browser (a tela de
 * autorização da Meta, hospedada pelo provedor).
 *
 * Nada é gravado no CRM aqui: quem grava é o callback, depois que a Meta
 * autorizou. Desistir na tela do Facebook não deixa sessão fantasma.
 * Spec 21 §3.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assinarVinculo, NOME_DO_VINCULO, VALIDADE_DO_VINCULO_S } from "@/lib/agenda/google/vinculo";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { PLATAFORMAS_SOCIAIS } from "@/lib/channels/plataformas";
import { CAMINHO_DO_CALLBACK_SOCIAL, iniciarConexaoSocial } from "@/lib/channels/social";
import { urlPublicaDaInstalacao } from "@/lib/channels/url-publica";
import { recusaPorLimite } from "@/lib/entitlements/exigir-na-rota";
import { traduzir } from "@/lib/i18n/dicionario";
import { authenticatedSessionId, requireSupportWrite } from "@/lib/impersonate/support";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.object({ platform: z.enum(PLATAFORMAS_SOCIAIS) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_social" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const lido = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("invalid_request", t("Escolha Instagram ou Messenger."), 422, { requestId });

  const admin = createAdminClient();
  // Limite do plano ANTES de mandar o operador para a Meta: descobrir o teto
  // depois de autorizar lá seria fazê-lo repetir o caminho à toa.
  const noTeto = await recusaPorLimite(authz.org.orgId, "max_channels", {
    admin,
    requestId,
    resource: "channels_social",
    actorUserId: authz.user.id,
  });
  if (noTeto) return noTeto;

  const r = await iniciarConexaoSocial(admin, {
    organizationId: authz.org.orgId,
    nomeDaOrganizacao: authz.org.name,
    userId: authz.user.id,
    authSessionId: await authenticatedSessionId(),
    plataforma: lido.data.platform,
    callbackUrl: `${urlPublicaDaInstalacao(req)}${CAMINHO_DO_CALLBACK_SOCIAL}`,
  });
  if (!r.ok) return fail("invalid_request", t(r.motivo), 422, { requestId });

  const resposta = ok({ auth_url: r.valor.authUrl }, { requestId });
  // O vínculo navegador ↔ tentativa. `lax` é o ponto: é enviado na navegação
  // top-level que volta do Facebook, onde o cookie de sessão (strict) não vai.
  // `secure` de `cookieSecure()`, nunca literal — self-host em http existe.
  resposta.cookies.set(NOME_DO_VINCULO, assinarVinculo(r.valor.nonce, env.INTERNAL_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_CALLBACK_SOCIAL,
    maxAge: VALIDADE_DO_VINCULO_S,
  });
  return resposta;
}
