import type pg from 'pg';

import { SECTOR_SLUG_RE } from '@/lib/setores/vocabulario';

/**
 * Setores de atendimento no TURNO do agente (spec 20 §3.2).
 *
 * Duas responsabilidades, e só elas:
 *   - o bloco residente do prompt que lista os setores ativos, para o modelo
 *     escolher um `sector` na ferramenta de handoff sem adivinhar;
 *   - a resolução do destino do handoff: slug do payload > setor de entrega
 *     do agente > nenhum. Slug desconhecido volta a LISTA válida, para virar
 *     erro de ensino ao modelo (nunca exceção, nunca strip silencioso).
 *
 * Sem setor ativo na organização nada disto aparece: o bloco não entra no
 * prompt e a ferramenta continua aceitando só `reason`, como antes.
 */

export interface SetorAtivo {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export async function carregarSetoresAtivos(db: pg.Pool, tenantId: string): Promise<SetorAtivo[]> {
  const { rows } = await db.query<SetorAtivo>(
    `select id, slug, name, description
       from sectors
      where organization_id = $1 and is_active
      order by name`,
    [tenantId],
  );
  return rows;
}

/** O bloco do prompt, ou `null` quando não há setor (nada a ensinar). */
export function renderBlocoDeSetores(setores: readonly SetorAtivo[]): string | null {
  if (setores.length === 0) return null;
  const linhas = setores.map((s) => {
    const desc = s.description.trim();
    return desc ? `- ${s.slug} — ${s.name}: ${desc}` : `- ${s.slug} — ${s.name}`;
  });
  return [
    'SETORES DE ATENDIMENTO. Ao chamar request_human_handoff, informe em `sector` o slug do',
    'setor certo para o assunto do cliente, escolhido desta lista (use a descrição para decidir):',
    ...linhas,
    'Se nenhum se aplicar, não envie `sector` — a conversa vai para o setor padrão deste agente.',
  ].join('\n');
}

export type ResolucaoDeSetor =
  | { ok: true; sectorId: string | null }
  | { ok: false; slugDesconhecido: string; slugsValidos: string[] };

/**
 * Slug do payload vence; sem slug, o setor de entrega do agente; sem os dois,
 * `null` = a conversa fica no setor em que já estava (pode ser nenhum).
 */
export async function resolverSetorDoHandoff(
  db: pg.Pool,
  tenantId: string,
  entrada: { slug?: string | undefined; agentSectorId?: string | null | undefined },
): Promise<ResolucaoDeSetor> {
  if (entrada.slug !== undefined) {
    if (!SECTOR_SLUG_RE.test(entrada.slug)) {
      const setores = await carregarSetoresAtivos(db, tenantId);
      return { ok: false, slugDesconhecido: entrada.slug, slugsValidos: setores.map((s) => s.slug) };
    }
    const { rows } = await db.query<{ id: string }>(
      `select id from sectors where organization_id = $1 and slug = $2 and is_active`,
      [tenantId, entrada.slug],
    );
    const achado = rows[0];
    if (achado) return { ok: true, sectorId: achado.id };
    const setores = await carregarSetoresAtivos(db, tenantId);
    return { ok: false, slugDesconhecido: entrada.slug, slugsValidos: setores.map((s) => s.slug) };
  }
  return { ok: true, sectorId: entrada.agentSectorId ?? null };
}
