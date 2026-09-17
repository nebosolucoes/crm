/**
 * O gate de PÁGINA — a primeira linha de todo `page.tsx` de destino vendável.
 *
 * ─── Por que por página, e não no layout ────────────────────────────────────
 *
 * O layout raiz de `/app` só roda no servidor na primeira carga e em
 * navegações que o remontam; uma navegação client-side entre irmãos
 * (`/app/inbox` → `/app/kanban`) NÃO o re-executa, então um gate ali deixaria
 * passar exatamente o clique que a pessoa dá. Route groups `(crm)/kanban`
 * resolveriam com um layout por recurso, mas moveriam ~60 arquivos e fariam
 * este fork conflitar com a `main` para sempre. A página é o único ponto que
 * roda a cada visita, servidor ou cliente. A cerca
 * `tests/unit/paginas-exigem-recurso.test.ts` cobra a chamada em toda página
 * cujo destino tem recurso.
 *
 * ─── O que faz, e o que NÃO faz ─────────────────────────────────────────────
 *
 * Redireciona para `/app/recurso-indisponivel?recurso=…` quando a organização
 * ativa não tem o recurso. Não decide papel (a página já decide, do seu jeito),
 * não substitui o gate da API (`requireRole({ feature })` é a parede; isto é a
 * porta), e `channels` responde sem ir ao banco. Sem organização ativa devolve
 * sem redirecionar: esse estado já tem dono no layout (`/get-started`,
 * `/acesso-revogado`).
 *
 * Usa as MESMAS memórias por request do layout (`loadAuthUser`,
 * `entitlementsDaOrg`): custo zero a mais.
 */
import { redirect } from "next/navigation";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";

import type { Recurso } from "./recursos";
import { orgTemRecurso } from "./resolver";

export const ROTA_DE_RECURSO_INDISPONIVEL = "/app/recurso-indisponivel";

export async function exigirRecurso(recurso: Recurso): Promise<void> {
  if (recurso === "channels") return;
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const org = await resolveActiveOrg(user);
  if (!org) return;
  if (!(await orgTemRecurso(org.orgId, recurso))) {
    redirect(`${ROTA_DE_RECURSO_INDISPONIVEL}?recurso=${recurso}`);
  }
}
