/**
 * O resolvedor do lado do Next — Server Components, Route Handlers, Server
 * Actions e crons. Pergunta ao banco UMA vez por request e dá forma à resposta.
 *
 * A regra não mora aqui: mora em `fn_org_entitlements` (migration 0275). Este
 * arquivo só sabe chamar a função e ler o jsonb — é o que garante que a API, o
 * layout e o worker (`resolver-pg.ts`) respondem a mesma coisa.
 *
 * ─── FALHA ALTO, não baixo ──────────────────────────────────────────────────
 *
 * Erro da RPC LANÇA. A alternativa — devolver "sem recurso" — faria uma
 * instabilidade do banco chegar ao cliente como downgrade de plano: o Sidebar
 * perderia grupos, a API responderia 403 `feature_not_entitled`, e ninguém
 * saberia que a causa é infraestrutura. É a mesma decisão de `loadAuthUser`
 * ("permissões não puderam ser resolvidas; a sessão NÃO foi rebaixada"). Quem
 * chama trata como trata qualquer falha de banco: 500 na rota, erro no layout.
 *
 * ─── Admin client, de propósito ─────────────────────────────────────────────
 *
 * Quem chama já resolveu a organização de fonte confiável (cookie validado
 * contra memberships em `resolveActiveOrg`, JWT em `requireRole`, linha do
 * token no MCP). A função no banco tem a própria guarda para sessões de
 * usuário; com service role ela responde sem guarda, o que é o certo para o
 * servidor que já sabe de quem está perguntando. NUNCA passe um `orgId` que
 * veio do body.
 */
import { cache } from "react";

import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { RECURSOS, type Recurso } from "./recursos";
import { lerEntitlements, temRecurso, type Entitlements } from "./tipos";

/**
 * Os entitlements da organização, memoizados por request (`react.cache`): o
 * layout, `requireRole` e a tela de plano podem perguntar à vontade dentro da
 * mesma requisição sem uma segunda ida ao banco.
 */
export const entitlementsDaOrg = cache(async (orgId: string): Promise<Entitlements> => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fn_org_entitlements", { p_org: orgId });
  if (error) {
    if (funcaoNaoExiste(error)) {
      logger.error("[entitlements] fn_org_entitlements NÃO EXISTE no banco — respondendo como o plano legado", {
        organization_id: orgId,
        code: error.code,
        message: error.message,
      });
      void avisarSentry(orgId, error);
      return SEM_SCHEMA;
    }
    logger.error("[entitlements] fn_org_entitlements falhou — NÃO tratado como sem recurso", {
      organization_id: orgId,
      code: error.code,
      message: error.message,
    });
    throw new Error(
      `entitlements_unavailable: ${error.message} — os recursos da organização não puderam ser ` +
        `resolvidos; a resposta NÃO foi rebaixada por decisão de autorização.`,
    );
  }
  return lerEntitlements(data);
});

/**
 * ─── A única degradação: a FUNÇÃO NÃO EXISTE ────────────────────────────────
 *
 * `PGRST202` (PostgREST não acha a função no schema cache) e `42883`
 * (Postgres: undefined_function). Não é instabilidade — é o banco que ainda
 * não recebeu a 0275. O caso concreto, já vivido neste repositório com
 * `fn_gasto_de_ia_do_mes`: o clone cujo `update.sh` (sem `ON_ERROR_STOP`)
 * engoliu o apêndice. Um 500 em TODAS as telas por isso é pior que o produto
 * se comportar como a versão anterior — que não tinha plano nenhum, isto é,
 * tudo ligado.
 *
 * Por isso a resposta é o equivalente ao plano legado, com `origem:
 * "sem_schema"` para a tela de Billing dizer a verdade ("o banco ainda não
 * recebeu a atualização de planos") e com erro no log e no Sentry. Não é um
 * buraco novo: é o comportamento que a instalação já tinha ontem, agora com
 * nome. Qualquer OUTRO erro continua lançando. Decisão do dono do produto,
 * 2026-09-17.
 */
function funcaoNaoExiste(error: { code?: string | null; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

const SEM_SCHEMA: Entitlements = Object.freeze({
  plan: null,
  origem: "sem_schema",
  features: new Set<Recurso>(RECURSOS),
  limits: {},
  overrides: [],
});

async function avisarSentry(orgId: string, error: { code?: string | null; message?: string }): Promise<void> {
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(new Error(`[entitlements] fn_org_entitlements ausente: ${error.message}`), {
      level: "error",
      tags: { subsystem: "entitlements", pg_code: error.code ?? "" },
      extra: { organization_id: orgId },
    });
  } catch {
    /* sem Sentry configurado, o log já registrou */
  }
}

/** A pergunta curta, pelo mesmo caminho memoizado. `channels` responde sem banco. */
export async function orgTemRecurso(orgId: string, recurso: Recurso): Promise<boolean> {
  if (recurso === "channels") return true;
  return temRecurso(await entitlementsDaOrg(orgId), recurso);
}
