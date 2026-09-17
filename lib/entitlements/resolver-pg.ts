/**
 * O resolvedor do lado do WORKER — o contêiner `worker` do agent-engine fala
 * com o banco por um pool `pg` cru, sem Supabase client. É por isso que a regra
 * mora em SQL: este arquivo e `resolver.ts` chamam a MESMA função e não podem
 * divergir.
 *
 * ─── Cache de 60 s por (organização, recurso) ───────────────────────────────
 *
 * O worker pergunta a cada job claimado e a cada evento drenado — dezenas de
 * vezes por minuto numa instalação ativa. Um minuto de atraso entre "o admin
 * liberou IA" e "a IA respondeu" é invisível para quem opera; uma ida ao banco
 * por job não é. `channels` nem entra no cache: responde `true` sem consultar
 * (camada 1 das três — ver `recursos.ts`).
 *
 * ─── Erro LANÇA; quem chama decide degradar ─────────────────────────────────
 *
 * Aqui a decisão certa é DIFERENTE da do Next. Na API, falha de banco vira 500
 * e a pessoa tenta de novo. No worker, um lead real está esperando resposta, e
 * "não consegui perguntar pelo plano" não pode virar "não respondo": é a mesma
 * escolha já feita no gate de elegibilidade (`drain.ts`: "falha da consulta NÃO
 * bloqueia o turno"). Este módulo não toma essa decisão pelo chamador — ele
 * lança, e cada ponto de gate escreve o `catch` com o log e o motivo.
 */
import type { Recurso } from "./recursos";

/** O mínimo de um `pg.Pool`/`pg.PoolClient` que este módulo usa. */
export interface ConsultaPg {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

const TTL_MS = 60_000;

interface Lembranca {
  valor: boolean;
  validoAte: number;
}

const memoria = new Map<string, Lembranca>();

function chave(orgId: string, recurso: Recurso): string {
  return `${orgId}:${recurso}`;
}

/**
 * `fn_org_has_feature(org, recurso)` com memória de 60 s. Lança se a consulta
 * falhar — ver o cabeçalho.
 */
export async function orgTemRecursoPg(
  db: ConsultaPg,
  orgId: string,
  recurso: Recurso,
  agora: number = Date.now(),
): Promise<boolean> {
  if (recurso === "channels") return true;
  const k = chave(orgId, recurso);
  const lembrada = memoria.get(k);
  if (lembrada && lembrada.validoAte > agora) return lembrada.valor;

  const { rows } = await db.query<{ tem: boolean }>(
    "select public.fn_org_has_feature($1::uuid, $2::text) as tem",
    [orgId, recurso],
  );
  const valor = rows[0]?.tem === true;
  memoria.set(k, { valor, validoAte: agora + TTL_MS });
  return valor;
}

/**
 * Esquece o que foi lembrado — para testes e para o dia em que um gate quiser
 * reler na hora (ex.: logo depois de o admin trocar o plano).
 */
export function esquecerEntitlementsPg(orgId?: string): void {
  if (!orgId) {
    memoria.clear();
    return;
  }
  for (const k of memoria.keys()) if (k.startsWith(`${orgId}:`)) memoria.delete(k);
}
