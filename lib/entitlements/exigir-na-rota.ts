/**
 * A recusa por RECURSO numa rota de API — uma função, chamada por
 * `requireRole({ feature })`, por `resolveAuthDual({ feature })` (no ramo do
 * Bearer) e, à mão, pelas poucas rotas legadas que ainda resolvem a sessão sem
 * `requireRole`. Um lugar só para o código de erro, o `details` e o audit —
 * senão nascem três 403 com três formas.
 *
 * NUNCA decide papel: quem chama já passou pelo gate de papel (e de MFA). Isto
 * vem DEPOIS, de propósito: quem não tem papel leva `forbidden_role` sem que a
 * resposta revele o plano da organização.
 *
 * Erro do resolvedor NÃO vira recusa: `entitlementsDaOrg` lança, e a rota
 * responde 500 como responde a qualquer falha de banco. Só a ausência da
 * função degrada (ver `resolver.ts`) — e aí a resposta é "tem", como antes.
 */
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { fail, type ApiError } from "@/lib/api/wrappers";

import { limiteAtingido } from "./consumo";
import { LIMITES, type ChaveDeLimite } from "./limites";
import { ROTULO_DO_RECURSO, type Recurso } from "./recursos";
import { orgTemRecurso } from "./resolver";

export interface RecusaPorRecursoOpts {
  requestId?: string;
  /** `resource_type` do `authz.denied`, o mesmo da rota. */
  resource?: string | null;
  /** Ator para o audit — usuário de sessão ou id do token. */
  actorUserId?: string | null;
  actorApiTokenId?: string | null;
}

/**
 * `null` quando a organização tem o recurso; a resposta 403 pronta quando não.
 * Audita a negativa como `authz.denied` com `reason: "feature_not_entitled"` —
 * o mesmo código das negativas de papel e de MFA, filtrável pelo `reason`.
 */
export async function recusaPorRecurso(
  organizationId: string,
  feature: Recurso,
  opts: RecusaPorRecursoOpts = {},
): Promise<NextResponse<ApiError> | null> {
  if (await orgTemRecurso(organizationId, feature)) return null;

  void audit({
    action: "authz.denied",
    actorUserId: opts.actorUserId ?? null,
    actorApiTokenId: opts.actorApiTokenId ?? null,
    organizationId,
    resourceType: opts.resource ?? null,
    requestId: opts.requestId ?? null,
    metadata: { reason: "feature_not_entitled", feature },
  });

  return fail(
    "feature_not_entitled",
    `${ROTULO_DO_RECURSO[feature]} não está incluído no plano desta organização.`,
    403,
    { requestId: opts.requestId, details: { feature } },
  );
}

/**
 * A recusa por LIMITE numa rota de CRIAÇÃO (etapa 8): `null` quando ainda cabe
 * (ou não há teto); a resposta 409 `limit_reached` com `details { limite, teto,
 * uso }` quando o teto foi alcançado. Audita como `authz.denied` com
 * `reason: "limit_reached"`. Vem DEPOIS do papel e do recurso — quem não tem
 * o módulo leva `feature_not_entitled`, não um teto de algo que nem tem.
 */
export async function recusaPorLimite(
  organizationId: string,
  chave: ChaveDeLimite,
  opts: RecusaPorRecursoOpts & { admin: SupabaseClient },
): Promise<NextResponse<ApiError> | null> {
  const atingido = await limiteAtingido(opts.admin, organizationId, chave);
  if (!atingido) return null;

  void audit({
    action: "authz.denied",
    actorUserId: opts.actorUserId ?? null,
    actorApiTokenId: opts.actorApiTokenId ?? null,
    organizationId,
    resourceType: opts.resource ?? null,
    requestId: opts.requestId ?? null,
    metadata: { reason: "limit_reached", limite: chave, ...atingido },
  });

  return fail(
    "limit_reached",
    `${LIMITES[chave].rotulo}: o plano permite ${atingido.teto} e a organização já usa ${atingido.uso}.`,
    409,
    { requestId: opts.requestId, details: { limite: chave, ...atingido } },
  );
}
