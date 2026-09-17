/**
 * O gate de plano de UMA ação de automação (migration 0275) — extraído do
 * motor para ter teste próprio sem levantar o motor inteiro.
 *
 * `null` = a ação pode rodar (tem o recurso, é do produto, ou a consulta
 * falhou — falha nunca barra). Senão, o `ActionResultDetail` já pronto:
 * `skipped` com `feature_not_entitled`, e o aviso na Central (um por
 * organização/recurso/mês) já disparado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { avisarBloqueioPorRecurso } from "@/lib/entitlements/aviso-na-central";
import { orgTemRecurso } from "@/lib/entitlements/resolver";

import { recursoDaAcao } from "./recurso-por-acao";
import type { ActionResultDetail } from "./types";

export async function resultadoSeForaDoPlano(
  admin: SupabaseClient,
  organizationId: string,
  actionType: string,
  ruleName: string,
): Promise<ActionResultDetail | null> {
  const recurso = recursoDaAcao(actionType);
  if (!recurso) return null;
  let tem = true;
  try {
    tem = await orgTemRecurso(organizationId, recurso);
  } catch {
    tem = true;
  }
  if (tem) return null;
  void avisarBloqueioPorRecurso(admin, organizationId, recurso, `A ação "${actionType}" da regra "${ruleName}"`);
  return { type: actionType, status: "skipped", error: "feature_not_entitled", detail: { feature: recurso } };
}
