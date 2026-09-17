/**
 * Qual recurso do plano cada tool MCP exige (migration 0275).
 *
 * O MCP tem DOIS ingressos que entram no mesmo handler — o servidor externo
 * (`lib/mcp/server.ts`, Bearer de `api_tokens`) e o runtime do agente
 * (`lib/ai/runtime/tools.ts`) — e os dois perguntam aqui antes de executar.
 * Um integrador com token de uma organização Starter pode ler conversas
 * (Atendimento), mas não criar negócio (CRM); o agente de uma organização sem
 * CRM não move funil mesmo tendo IA.
 *
 * A regra é POR DOMÍNIO com exceções POR TOOL — o mesmo desenho de
 * `lib/entitlements/rotas.ts`, pelo mesmo motivo: a pasta é uma boa
 * aproximação e uma péssima verdade. `operacao/` mistura etapas do funil (CRM)
 * com webhooks e equipe (produto); `retencao/` mistura follow-up (IA) com a
 * lista de negócios em risco (CRM).
 *
 * `null` = capacidade do produto, nunca gateada por plano. Tool fora dos dois
 * mapas = a cerca reprova ("declare"), nunca "liberado".
 */
import type { Recurso } from "@/lib/entitlements/recursos";

import { TOOLS_AGENDAMENTO } from "./agendamento";
import { TOOLS_ATENDIMENTO } from "./atendimento";
import { TOOLS_COMERCIO } from "./comercio";
import { TOOLS_ESCALACAO } from "./escalacao";
import { TOOLS_EVOLUCAO } from "./evolucao";
import { TOOLS_FUNIL } from "./funil";
import { TOOLS_GOVERNANCA } from "./governanca";
import { TOOLS_OPERACAO } from "./operacao";
import { TOOLS_RETENCAO } from "./retencao";
import type { McpToolCatalogEntry } from "./tipos";

const DOMINIOS: ReadonlyArray<readonly [ReadonlyArray<McpToolCatalogEntry>, Recurso | null]> = [
  [TOOLS_AGENDAMENTO, "inbox"],
  [TOOLS_ATENDIMENTO, "inbox"],
  [TOOLS_ESCALACAO, "inbox"],
  [TOOLS_GOVERNANCA, "inbox"],
  [TOOLS_FUNIL, "crm"],
  [TOOLS_COMERCIO, "crm"],
  [TOOLS_EVOLUCAO, "ai_agents"],
  [TOOLS_RETENCAO, "ai_agents"],
  // Etapas do funil são CRM; o resto (webhooks, automação, equipe, modelos de
  // resposta, etiquetas) é do produto. Ver as exceções abaixo.
  [TOOLS_OPERACAO, null],
];

/** Exceções por tool — vencem o domínio. */
export const RECURSO_POR_TOOL: Readonly<Record<string, Recurso | null>> = {
  crm_list_stages: "crm",
  crm_create_stage: "crm",
  crm_update_stage: "crm",
  crm_archive_stage: "crm",
  // Negócios em risco é leitura do funil, não follow-up.
  crm_list_at_risk_leads: "crm",
  // Encerrar uma demanda é ato do atendimento, com ou sem IA.
  crm_close_demand: "inbox",
  // Pedidos de privacidade são direito (LGPD), nunca plano.
  crm_list_privacy_requests: null,
  // Etiquetar é vocabulário da organização, do produto.
  crm_manage_tags: null,
};

const POR_DOMINIO = new Map<string, Recurso | null>();
for (const [tools, recurso] of DOMINIOS) {
  for (const t of tools) POR_DOMINIO.set(t.name, recurso);
}

/**
 * `Recurso` → a organização precisa tê-lo; `null` → do produto; `undefined` →
 * tool que nenhum mapa conhece (a cerca reprova).
 */
export function recursoDaTool(name: string): Recurso | null | undefined {
  if (Object.hasOwn(RECURSO_POR_TOOL, name)) return RECURSO_POR_TOOL[name];
  return POR_DOMINIO.get(name);
}
