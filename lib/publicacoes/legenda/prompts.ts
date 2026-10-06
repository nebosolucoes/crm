import type pg from "pg";

import type { AlterarPrompt, CriarPrompt, PromptDeLegenda } from "@/lib/publicacoes/legenda/instrucoes";

/**
 * Leitura e escrita dos prompts de legenda (migration 0286), pelo pool do
 * servidor — o mesmo das rotas de IA. Toda consulta filtra `organization_id`
 * vindo da sessão (o pool não passa pela RLS), e a troca de contas de um
 * prompt é UMA transação: tirar a conta do prompt antigo e pô-la no novo não
 * pode ficar pela metade.
 */

export class ErroDePrompt extends Error {
  constructor(
    public readonly codigo: "not_found" | "account_invalid",
    mensagem: string,
    public readonly status: number,
  ) {
    super(mensagem);
  }
}

interface Linha {
  id: string;
  name: string;
  instructions: string;
  updated_at: Date | string;
  channel_session_ids: string[] | null;
}

const SELECT = `
  select p.id, p.name, p.instructions, p.updated_at,
         coalesce(array_agg(a.channel_session_id order by a.created_at) filter (where a.channel_session_id is not null), '{}') as channel_session_ids
    from publication_caption_prompts p
    left join publication_caption_prompt_accounts a
      on a.prompt_id = p.id and a.organization_id = p.organization_id
   where p.organization_id = $1`;

function forma(l: Linha): PromptDeLegenda {
  return {
    id: l.id,
    name: l.name,
    instructions: l.instructions,
    channel_session_ids: l.channel_session_ids ?? [],
    updated_at: l.updated_at instanceof Date ? l.updated_at.toISOString() : l.updated_at,
  };
}

export async function listarPrompts(db: pg.Pool, orgId: string): Promise<PromptDeLegenda[]> {
  const { rows } = await db.query<Linha>(`${SELECT} group by p.id order by p.created_at`, [orgId]);
  return rows.map(forma);
}

export async function lerPrompt(db: pg.Pool | pg.PoolClient, orgId: string, id: string): Promise<PromptDeLegenda | null> {
  const { rows } = await db.query<Linha>(`${SELECT} and p.id = $2 group by p.id`, [orgId, id]);
  return rows[0] ? forma(rows[0]) : null;
}

/** As contas pedidas existem, são desta organização e não estão arquivadas. */
async function conferirContas(c: pg.PoolClient, orgId: string, ids: readonly string[]) {
  if (ids.length === 0) return;
  const unicos = [...new Set(ids)];
  const { rows } = await c.query<{ id: string }>(
    "select id from channel_sessions where organization_id = $1 and id = any($2::uuid[]) and archived_at is null",
    [orgId, unicos],
  );
  if (rows.length !== unicos.length) throw new ErroDePrompt("account_invalid", "Uma das contas escolhidas não existe mais nesta organização.", 422);
}

/** Troca o conjunto de contas do prompt: as que vierem de outro prompt mudam de dono. */
async function gravarContas(c: pg.PoolClient, orgId: string, promptId: string, ids: readonly string[]) {
  const unicos = [...new Set(ids)];
  await c.query(
    "delete from publication_caption_prompt_accounts where organization_id = $1 and (prompt_id = $2 or channel_session_id = any($3::uuid[]))",
    [orgId, promptId, unicos],
  );
  if (unicos.length > 0) {
    await c.query(
      `insert into publication_caption_prompt_accounts (organization_id, prompt_id, channel_session_id)
       select $1, $2, unnest($3::uuid[])`,
      [orgId, promptId, unicos],
    );
  }
}

async function emTransacao<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (err) {
    await c.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export async function criarPrompt(db: pg.Pool, orgId: string, userId: string, entrada: CriarPrompt): Promise<PromptDeLegenda> {
  return emTransacao(db, async (c) => {
    await conferirContas(c, orgId, entrada.channel_session_ids);
    const { rows } = await c.query<{ id: string }>(
      `insert into publication_caption_prompts (organization_id, name, instructions, created_by, updated_by)
       values ($1, $2, $3, $4, $4) returning id`,
      [orgId, entrada.name, entrada.instructions, userId],
    );
    const id = rows[0]!.id;
    await gravarContas(c, orgId, id, entrada.channel_session_ids);
    return (await lerPrompt(c, orgId, id))!;
  });
}

export async function alterarPrompt(db: pg.Pool, orgId: string, userId: string, id: string, entrada: AlterarPrompt): Promise<PromptDeLegenda> {
  return emTransacao(db, async (c) => {
    const { rowCount } = await c.query(
      `update publication_caption_prompts
          set name = coalesce($3, name), instructions = coalesce($4, instructions), updated_by = $5
        where organization_id = $1 and id = $2`,
      [orgId, id, entrada.name ?? null, entrada.instructions ?? null, userId],
    );
    if (!rowCount) throw new ErroDePrompt("not_found", "Prompt não encontrado.", 404);
    if (entrada.channel_session_ids) {
      await conferirContas(c, orgId, entrada.channel_session_ids);
      await gravarContas(c, orgId, id, entrada.channel_session_ids);
    }
    return (await lerPrompt(c, orgId, id))!;
  });
}

export async function excluirPrompt(db: pg.Pool, orgId: string, id: string): Promise<void> {
  const { rowCount } = await db.query("delete from publication_caption_prompts where organization_id = $1 and id = $2", [orgId, id]);
  if (!rowCount) throw new ErroDePrompt("not_found", "Prompt não encontrado.", 404);
}
