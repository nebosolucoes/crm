/**
 * O recurso que cada PÁGINA de `app/app/**` exige — derivado do catálogo de
 * navegação (`recursoDoDestino`), com as poucas rotas que não são destino
 * declaradas aqui.
 *
 * Uma página fora do catálogo é uma de três coisas: um hub de grupo (que o
 * catálogo conhece como `NAV_GROUPS[].hub`, não como destino), uma tela de
 * detalhe alcançada de dentro de uma lista (`/app/leads/[id]`), ou um
 * redirect legado. Nenhuma delas pode ficar "liberada por omissão": a cerca
 * `tests/unit/paginas-exigem-recurso.test.ts` reprova página que nenhum dos
 * dois mapas conhece.
 *
 * Client-safe: só o vocabulário e o catálogo.
 */
import { NAV_GROUPS } from "@/lib/navigation/catalogo";

import { GRUPO_PARA_RECURSO, recursoDoDestino, type Recurso } from "./recursos";

/** Rotas de página fora do catálogo. `null` = do produto. */
export const RECURSO_POR_PAGINA_FORA_DO_CATALOGO: Readonly<Record<string, Recurso | null>> = {
  // A home decide para onde ir (`homeDaInterface`) — não é um destino.
  "/app": null,
  // Telas de detalhe: alcançadas de dentro da lista do grupo.
  "/app/leads": "crm",
  "/app/pipelines": "crm",
  // Redirect legado para /app/disparo/lista; o destino real é quem gateia.
  "/app/agendamentos": null,
  // Onde o gate deixa quem não tem o recurso — gateá-la seria um laço.
  "/app/recurso-indisponivel": null,
};

/**
 * `Recurso` → a página chama `exigirRecurso`; `null` → do produto;
 * `undefined` → ninguém declarou (a cerca reprova).
 *
 * A rota vem do disco no formato do App Router (`/app/leads/[id]`); os
 * segmentos dinâmicos herdam do pai por prefixo, como as subrotas do catálogo.
 */
export function recursoDaPagina(rota: string): Recurso | null | undefined {
  const r = rota.replace(/\/+$/, "") || "/";
  const doCatalogo = recursoDoDestino(r);
  if (doCatalogo !== undefined) return doCatalogo;

  // Hub de grupo: `/app/crm`, `/app/ai`, `/app/analise`, `/app/settings`.
  const hub = NAV_GROUPS.find((g) => g.hub && (r === g.hub.href || r.startsWith(`${g.hub.href}/`)));
  if (hub) return GRUPO_PARA_RECURSO[hub.id];

  let melhor: { prefixo: string; recurso: Recurso | null } | null = null;
  for (const [prefixo, recurso] of Object.entries(RECURSO_POR_PAGINA_FORA_DO_CATALOGO)) {
    // `/app` é EXATO: como prefixo ele engoliria toda página nova do app como
    // "do produto", e página nova tem de ser declarada, nunca herdada.
    if (prefixo === "/app" ? r !== prefixo : r !== prefixo && !r.startsWith(`${prefixo}/`)) continue;
    if (!melhor || prefixo.length > melhor.prefixo.length) melhor = { prefixo, recurso };
  }
  return melhor?.recurso;
}
