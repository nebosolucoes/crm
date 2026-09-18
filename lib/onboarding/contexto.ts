/**
 * O contexto que decide QUAIS passos do onboarding esta organização vê —
 * montado num lugar só, para as três telas do wizard (índice, layout, resumo
 * final) não divergirem.
 *
 * Antes era `{ lojaLigada: env.NUVEMSHOP_ENABLED }` repetido em três arquivos.
 * Com o plano (migration 0275) entram mais duas perguntas — a organização tem
 * Agentes de IA? tem CRM? —, e repeti-las em três lugares é o modo de falha
 * que a extração de `passos.ts` já tinha eliminado uma vez.
 *
 * Lê pela mesma memória por request do layout de `/app` (`entitlementsDaOrg`).
 */
import { env } from "@/lib/env";
import { entitlementsDaOrg } from "@/lib/entitlements/resolver";
import { temRecurso } from "@/lib/entitlements/tipos";

import type { ContextoDoPasso } from "./passos";

export async function contextoDoOnboarding(orgId: string): Promise<ContextoDoPasso> {
  const e = await entitlementsDaOrg(orgId);
  return {
    lojaLigada: env.NUVEMSHOP_ENABLED,
    iaLigada: temRecurso(e, "ai_agents"),
    crmLigado: temRecurso(e, "crm"),
  };
}
