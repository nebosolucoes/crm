/**
 * Qual recurso do plano cada AÇÃO de automação exige (migration 0275).
 *
 * As regras de automação vivem em Canais (aba Webhooks), que todo plano tem —
 * mas as ações cruzam módulos: uma regra pode mandar a IA responder
 * (`ai_agents`), criar um negócio no funil (`crm`) ou atribuir a conversa a
 * alguém (`inbox`). O gate é POR AÇÃO, dentro do motor: as outras ações da
 * mesma regra continuam rodando, e a que foi barrada aparece como `skipped`
 * com `feature_not_entitled` na aba Atividade — nunca como sucesso.
 *
 * `null` = ação do produto. Tipo fora do mapa = a cerca
 * (`lib/automation/recurso-por-acao.test.ts`) reprova; em runtime segue sem
 * gate, porque um tipo novo não pode virar regra morta em silêncio.
 */
import type { Recurso } from "@/lib/entitlements/recursos";

export const RECURSO_POR_ACAO: Readonly<Record<string, Recurso | null>> = {
  send_ai_message: "ai_agents",
  start_message_flow: "ai_agents",
  create_or_move_lead: "crm",
  assign_owner: "inbox",
  send_whatsapp_message: "inbox",
  add_tag: null,
  call_webhook: null,
};

export function recursoDaAcao(type: string): Recurso | null | undefined {
  return Object.hasOwn(RECURSO_POR_ACAO, type) ? RECURSO_POR_ACAO[type] : undefined;
}
