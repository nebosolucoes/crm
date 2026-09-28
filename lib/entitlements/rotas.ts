/**
 * Qual recurso do plano cada família de rotas `/api/v1/*` exige — a fonte
 * única, lida por quem escreve a rota (para saber o que declarar) e pela cerca
 * `tests/unit/rotas-declaram-recurso.test.ts` (para cobrar a declaração).
 *
 * A REGRA É POR ROTA, NÃO POR PASTA — e é por isso que este mapa existe em vez
 * de um `startsWith` no teste. Os dois casos que ensinaram isso:
 *
 *   - `contacts/**` serve o painel lateral do Inbox E a tela de Contatos (CRM).
 *     Gatear a pasta inteira por `crm` quebraria o Atendimento de todo plano
 *     Starter. Só o que é ESPECIFICAMENTE de CRM (importação de planilha, o
 *     resumo do funil no contato) exige `crm`.
 *   - `ai/inbox/**` é a Central de avisos: por ela o sistema fala com a
 *     organização, inclusive para dizer "seu plano mudou". Fica fora de
 *     `ai_agents`, e é a única pasta de `ai/` que fica.
 *
 * O prefixo MAIS LONGO vence, então a exceção se declara ao lado da família.
 * `null` = rota do produto: nunca gateada por plano. Pasta ausente daqui = a
 * cerca reprova ("declare"), nunca "liberado".
 *
 * Fora do mapa de propósito, por terem outro guardião: `admin/*`
 * (`requirePlatformAdmin`), `cron/*` (`autorizaCron`), `webhooks/*` (HMAC e
 * token de path) e `auth/*`, `health`, `system/*`, `onboarding/*`, `mcp/*`
 * (o MCP gateia por TOOL — ver `lib/mcp/server.ts`).
 */
import type { Recurso } from "./recursos";

/** Prefixos relativos a `app/api/v1/`, sem barra inicial. */
export const RECURSO_POR_ROTA: ReadonlyArray<readonly [prefixo: string, recurso: Recurso | null]> = [
  // ── Disparo ──
  ["agendamentos", "broadcast"],

  // ── Agentes de IA — tudo, menos a Central ──
  ["ai", "ai_agents"],
  ["ai/inbox", null],

  // ── CRM ──
  ["leads", "crm"],
  ["pipelines", "crm"],
  ["products", "crm"],
  ["tasks", "crm"],
  ["lead-captures", "crm"],
  ["contact-tags", "crm"],
  ["contacts", null],
  ["contacts/import", "crm"],
  ["contacts/[id]/crm-summary", "crm"],

  // ── Análises — o Audit Log fica fora (é direito, não plano) ──
  ["metrics", "analytics"],
  ["reports", "analytics"],
  ["ads", "analytics"],
  ["audit", null],

  // ── Atendimento ──
  ["conversations", "inbox"],
  ["messages", "inbox"],
  ["attendants", "inbox"],
  ["message-templates", "inbox"],
  ["demandas", "inbox"],
  ["agenda", "inbox"],
  ["conversation-tags", "inbox"],
  ["voice", "inbox"],
  // Setores de atendimento (spec 20): parte do módulo de atendimento.
  ["sectors", "inbox"],

  // ── Do produto: Canais e Organização ──
  ["channel-sessions", null],
  ["channels", null],
  ["webhook-sources", null],
  ["automation-rules", null],
  ["integrations", null],
  ["team", null],
  ["settings", null],
  ["lgpd", null],
  ["tags", null],
  ["notifications", null],
  ["marca", null],
  // Extensões declarativas (0271): instalar/configurar é operação da organização, não módulo do plano.
  ["extensions", null],
];

/**
 * O recurso que uma rota exige, pelo caminho relativo a `app/api/v1/`
 * (ex.: `leads/[id]/move`). `undefined` = família não declarada — a cerca
 * trata como erro, nunca como liberado.
 */
export function recursoDaRota(caminho: string): Recurso | null | undefined {
  const c = caminho.replace(/^\/+|\/+$/g, "");
  let melhor: { prefixo: string; recurso: Recurso | null } | null = null;
  for (const [prefixo, recurso] of RECURSO_POR_ROTA) {
    if (c !== prefixo && !c.startsWith(`${prefixo}/`)) continue;
    if (!melhor || prefixo.length > melhor.prefixo.length) melhor = { prefixo, recurso };
  }
  return melhor?.recurso;
}
