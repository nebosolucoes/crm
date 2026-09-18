/**
 * O vocabulário de RECURSOS (features) que um plano comercial liga ou desliga
 * numa organização — a ÚNICA lista.
 *
 * ─── Três palavras que não se confundem ─────────────────────────────────────
 *
 *   plano        pacote comercial contratado pela organização. É DADO: nasce
 *                pela tela do admin, sem deploy (`platform_plans`).
 *   recurso      módulo do produto. NÃO é dado: só existe porque há um
 *                `requireRole({ feature })` numa rota, um `exigirRecurso()` numa
 *                página e um grupo de navegação apontando para ele. Uma linha
 *                no banco que o código não gateia seria um checkbox que não
 *                faz nada — por isso o vocabulário mora AQUI, e o banco só o
 *                espelha num CHECK.
 *   entitlement  a resposta "esta organização pode usar este recurso?", já
 *                resolvida (plano + overrides). Ver `tipos.ts`.
 *
 * A permissão da PESSOA (papel, `lib/auth/types.ts`) é outro eixo e continua
 * intacta: organização possui recurso E usuário possui papel = acesso.
 * Nenhum dos dois substitui o outro.
 *
 * ─── `channels` não é dado, é lei ───────────────────────────────────────────
 *
 * Canais é por onde o cliente conecta o WhatsApp — sem ele o produto não faz
 * nada, e um erro de configuração não pode desligá-lo. Ele NÃO aparece em
 * `RECURSOS_VENDAVEIS`, não é linha em `platform_plan_features`, e o resolvedor
 * (SQL e TypeScript) o inclui incondicionalmente. Três camadas, para que
 * nenhuma delas seja o único ponto de falha:
 *
 *   1. aqui: `temRecurso()` (tipos.ts) curto-circuita para `true` antes de
 *      olhar qualquer dado;
 *   2. no banco: `fn_org_entitlements` faz `union select 'channels'`;
 *   3. no schema: `organization_feature_overrides` tem CHECK
 *      `feature <> 'channels' or mode <> 'disable'`.
 *
 * ─── Como acrescentar um recurso novo (a receita, para não se perder) ───────
 *
 *   1. valor em `RECURSOS` e em `RECURSOS_VENDAVEIS`;
 *   2. entrada em `GRUPO_PARA_RECURSO` (ou um grupo novo em
 *      `lib/navigation/catalogo.ts`) e rótulo em `ROTULO_DO_RECURSO`;
 *   3. migration que reconstrói os DOIS CHECKs (`platform_plan_features.feature`
 *      e `organization_feature_overrides.feature`) num bloco só no baseline —
 *      `tests/invariants/vocabulario-banco-x-typescript.test.ts` cobra a paridade
 *      com os símbolos deste arquivo;
 *   4. `feature:` nas rotas e `exigirRecurso()` nas páginas do módulo.
 *
 * Os passos 1, 2 e 4 seriam necessários com qualquer modelo de banco; o 3 é o
 * preço de o banco recusar um valor que o código não conhece. Foi avaliado um
 * catálogo `platform_features` com FK e recusado: trocaria o CHECK por uma
 * migration de seed, acrescentaria um join e um invariante, e não pouparia
 * nenhum dos outros passos.
 *
 * ─── Este módulo é CLIENT-SAFE ──────────────────────────────────────────────
 *
 * Só importa de `lib/navigation/catalogo.ts`, que também é. Nada de zod,
 * supabase, `next/headers` ou `lib/env` — o Sidebar e a paleta ⌘K importam daqui.
 */
import { NAV_CATALOG, type NavGroupId } from "@/lib/navigation/catalogo";

/** Todos os recursos, inclusive o que nunca se desliga. Espelha o CHECK de `organization_feature_overrides.feature`. */
export const RECURSOS = ["channels", "inbox", "broadcast", "crm", "ai_agents", "analytics"] as const;
export type Recurso = (typeof RECURSOS)[number];

/** Os que um plano pode incluir ou não. Espelha o CHECK de `platform_plan_features.feature`. */
export const RECURSOS_VENDAVEIS = ["inbox", "broadcast", "crm", "ai_agents", "analytics"] as const;
export type RecursoVendavel = (typeof RECURSOS_VENDAVEIS)[number];

/** Ligados em TODA organização, sempre, independentemente de plano ou override. */
export const RECURSOS_SEMPRE_LIGADOS = ["channels"] as const satisfies readonly Recurso[];

export function ehRecurso(valor: unknown): valor is Recurso {
  return typeof valor === "string" && (RECURSOS as readonly string[]).includes(valor);
}

export function ehRecursoVendavel(valor: unknown): valor is RecursoVendavel {
  return typeof valor === "string" && (RECURSOS_VENDAVEIS as readonly string[]).includes(valor);
}

export function sempreLigado(recurso: Recurso): boolean {
  return (RECURSOS_SEMPRE_LIGADOS as readonly string[]).includes(recurso);
}

/**
 * Qual recurso governa cada grupo da navegação.
 *
 * `null` = o grupo não é vendável: Organização (conta, equipe, LGPD, tokens) é
 * do produto, não do plano. É por esta tabela que o Sidebar, os hubs e o ⌘K
 * deixam de desenhar um grupo inteiro quando a organização não tem o recurso —
 * sem que nenhum deles decida nada sozinho (`lib/navigation/interface.ts`).
 *
 * `Record<NavGroupId, …>` é exaustivo de propósito: grupo novo no catálogo sem
 * linha aqui não compila.
 */
export const GRUPO_PARA_RECURSO: Record<NavGroupId, Recurso | null> = {
  atendimento: "inbox",
  disparo: "broadcast",
  crm: "crm",
  ia: "ai_agents",
  canais: "channels",
  analise: "analytics",
  organizacao: null,
};

/**
 * Destinos que ficam FORA do recurso do seu grupo — exceções declaradas, com
 * o motivo ao lado.
 *
 * `/app/audit` mora no grupo Análise porque é onde se consulta histórico, mas
 * não é vendável: quem fez o quê numa organização é resposta a direito (LGPD,
 * forense de incidente), e um plano não pode tirá-la de quem administra.
 * Decisão do dono do produto (2026-09-17).
 *
 * `/app/ai/inbox` é a Central de avisos. Mora no grupo IA por história, mas é
 * por ela que o SISTEMA fala com a organização: conexão caída (`qr_rescan`),
 * mensagem presa (`message_send_stuck`), e — desde a 0275 — "seu plano mudou"
 * (`entitlement_changed`). Escondê-la de quem não tem IA deixaria a
 * organização sem o lugar onde se avisa que ela não tem IA. O GRUPO some do
 * menu (`sidebarGroups`); a Central segue pelo sino e pelo ⌘K.
 */
export const DESTINOS_SEM_RECURSO: ReadonlySet<string> = new Set(["/app/audit", "/app/ai/inbox"]);

/**
 * O recurso que uma URL do app exige.
 *
 *   - `Recurso`   → a organização precisa tê-lo;
 *   - `null`      → destino do produto, nunca gateado (Organização, exceções);
 *   - `undefined` → a URL não é de nenhum destino do catálogo. Quem chama decide
 *                   o que fazer com isso — a cerca de páginas (etapa 5) trata
 *                   como "declare explicitamente", nunca como "liberado".
 *
 * Casa por destino EXATO ou por prefixo com fronteira de segmento: `/app/kanban`
 * governa `/app/kanban/qualquer-coisa`, mas `/app/ai` não governa `/app/aiX`.
 * O prefixo mais longo vence, para que `/app/settings/tenant/pipelines` (CRM)
 * não seja engolido por `/app/settings` (Organização).
 */
export function recursoDoDestino(pathname: string): Recurso | null | undefined {
  const caminho = pathname.replace(/\/+$/, "") || "/";
  let melhor: { href: string; group: NavGroupId } | null = null;
  for (const destino of NAV_CATALOG) {
    const href = destino.href;
    const casa = caminho === href || caminho.startsWith(`${href}/`);
    if (!casa) continue;
    if (!melhor || href.length > melhor.href.length) melhor = { href, group: destino.group };
  }
  if (!melhor) return undefined;
  if (DESTINOS_SEM_RECURSO.has(melhor.href)) return null;
  return GRUPO_PARA_RECURSO[melhor.group];
}

/**
 * Como o recurso se chama para quem compra e para quem configura. pt-BR aqui;
 * as telas passam por `traduzir()` como todo texto do produto — o texto é a
 * chave do dicionário, então é ele que os outros idiomas referenciam.
 */
export const ROTULO_DO_RECURSO: Record<Recurso, string> = {
  channels: "Canais",
  inbox: "Atendimento",
  broadcast: "Disparo",
  crm: "CRM",
  ai_agents: "Agentes de IA",
  analytics: "Análises",
};

/** O que a pessoa perde ou ganha, numa frase — para a tela de plano e para a tela de recurso indisponível. */
export const DESCRICAO_DO_RECURSO: Record<Recurso, string> = {
  channels: "Conectar números de WhatsApp e outros canais por onde as mensagens entram e saem.",
  inbox: "Atender conversas no Inbox, com agenda, respostas rápidas e radar de quem esfriou.",
  broadcast: "Programar envios para grupos, com recorrência e histórico de entrega.",
  crm: "Funis de venda, contatos, tarefas e catálogo de produtos.",
  ai_agents: "Agentes que atendem, qualificam e movem o funil sozinhos, com follow-ups e conhecimento.",
  analytics: "Desempenho do funil, atividade da equipe e resultado dos anúncios.",
};
