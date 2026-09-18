/**
 * O aviso na Central quando algo deixa de rodar por falta de recurso no plano
 * — o laço de retorno (invariante 7 da doutrina Sistema Vivo).
 *
 * Um worker que pula um disparo ou um turno de IA porque a organização não
 * tem o recurso NÃO pode fazer isso em silêncio: quem opera veria "a IA parou
 * de responder" sem nenhuma linha dizendo por quê. O aviso é UM por
 * organização, recurso e mês — a mesma cadência de `budget_warning`: o
 * primeiro pulo do mês avisa; os seguintes não empilham.
 *
 * Duas portas para o mesmo texto, porque há dois clientes de banco (o worker
 * fala `pg`, os crons falam Supabase). A deduplicação do `pg` é atômica
 * (`insert … where not exists`); a do Supabase é ler-e-inserir, e a corrida
 * possível custa no máximo um aviso repetido — não um a menos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConsultaPg } from "./resolver-pg";
import { ROTULO_DO_RECURSO, type Recurso } from "./recursos";

export const KIND_DO_AVISO = "entitlement_changed";

/** Título fixo por recurso: é a chave da deduplicação mensal. */
export function tituloDoAvisoDeBloqueio(recurso: Recurso): string {
  return `${ROTULO_DO_RECURSO[recurso]} não está no plano — algo deixou de rodar`;
}

export function corpoDoAvisoDeBloqueio(recurso: Recurso, oQue: string): string {
  return (
    `${oQue} não foi executado porque ${ROTULO_DO_RECURSO[recurso]} não está incluído no plano ` +
    `desta organização. Nada foi perdido: quando o recurso for liberado, o que estiver ` +
    `agendado volta a rodar. Veja o plano em Configurações › Billing.`
  );
}

/** Worker (`pg`): atômico. Devolve `true` quando ESTE chamado criou o aviso. */
export async function avisarBloqueioPorRecursoPg(
  db: ConsultaPg,
  organizationId: string,
  recurso: Recurso,
  oQue: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `insert into agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
     select $1::uuid, $2, 'warn', $3, $4, 'organization', $1::uuid
      where not exists (
        select 1 from agent_inbox_items
         where organization_id = $1::uuid and kind = $2 and title = $3
           and created_at >= date_trunc('month', now())
      )
     returning id`,
    [organizationId, KIND_DO_AVISO, tituloDoAvisoDeBloqueio(recurso), corpoDoAvisoDeBloqueio(recurso, oQue)],
  );
  return rows.length > 0;
}

/** Crons (Supabase admin client): ler-e-inserir. Falha vira `false`, nunca lança. */
export async function avisarBloqueioPorRecurso(
  admin: SupabaseClient,
  organizationId: string,
  recurso: Recurso,
  oQue: string,
): Promise<boolean> {
  const titulo = tituloDoAvisoDeBloqueio(recurso);
  const inicioDoMes = new Date();
  inicioDoMes.setUTCDate(1);
  inicioDoMes.setUTCHours(0, 0, 0, 0);
  const { count, error: erroLeitura } = await admin
    .from("agent_inbox_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("kind", KIND_DO_AVISO)
    .eq("title", titulo)
    .gte("created_at", inicioDoMes.toISOString());
  if (erroLeitura || (count ?? 0) > 0) return false;
  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: organizationId,
    kind: KIND_DO_AVISO,
    severity: "warn",
    title: titulo,
    body: corpoDoAvisoDeBloqueio(recurso, oQue),
    ref_kind: "organization",
    ref_id: organizationId,
  });
  return !error;
}
