/**
 * Planos e entitlements (migration 0275) — o que o banco garante sozinho.
 *
 * Três famílias, num arquivo só porque partilham a mesma semente:
 *
 *   1. CANAIS SEMPRE — as três camadas que impedem desligar `channels`: o CHECK
 *      recusa o override, a função o inclui mesmo num plano vazio, e a resposta
 *      curta é `true` até para organização sem plano nenhum.
 *   2. RESOLUÇÃO — plano atribuído, padrão por trigger, overrides ativos /
 *      vencidos / futuros / revogados, `disable` vencendo `enable`, limites
 *      mesclados com o mais novo por cima, plano inativo recusado na atribuição
 *      mas mantido para quem já está nele.
 *   3. RLS E ESCRITA — tenant não lê catálogo nem override alheio; nenhuma
 *      escrita para `authenticated`; `plan_id` só muda pela função; as funções
 *      de escrita exigem platform admin `full` e EXECUTE só de `service_role`.
 *
 * Roda COMO o PostgREST fala com o banco: `set local role` + `request.jwt.claims`
 * — a mesma forma de `cliente-nasce-do-agendamento.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { RECURSOS, RECURSOS_VENDAVEIS } from "@/lib/entitlements/recursos";
import { lerEntitlements, temRecurso } from "@/lib/entitlements/tipos";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 5,
});

const ORG_A = "e17e0000-0000-4000-8000-000000000001";
const ORG_B = "e17e0000-0000-4000-8000-000000000002";
const ORG_SEM_PADRAO = "e17e0000-0000-4000-8000-000000000003";

const ADMIN_A = "e17e1111-0000-4000-8000-000000000001";
const VIEWER_B = "e17e1111-0000-4000-8000-000000000002";
const PLATAFORMA = "e17e1111-0000-4000-8000-000000000003";
const PLATAFORMA_RO = "e17e1111-0000-4000-8000-000000000004";

interface Opcoes {
  papel?: "authenticated" | "service_role" | "anon";
}

/** SQL como o usuário (ou como service_role / anon), em transação própria. */
async function como<T extends pg.QueryResultRow>(
  uid: string | null,
  sql: string,
  params: unknown[] = [],
  opcoes: Opcoes = {},
): Promise<pg.QueryResult<T>> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const papel = opcoes.papel ?? "authenticated";
    await c.query(`set local role ${papel}`);
    const claims =
      papel === "service_role"
        ? { role: "service_role" }
        : papel === "anon"
          ? { role: "anon" }
          : { sub: uid, role: "authenticated", aal: "aal1" };
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const r = await c.query<T>(sql, params);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

async function codigoDoErro(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "sem_erro";
  } catch (e) {
    return (e as { code?: string }).code ?? "sem_codigo";
  }
}

async function entitlements(org: string, uid: string | null = null, opcoes: Opcoes = { papel: "service_role" }) {
  const r = await como<{ e: unknown }>(uid, "select public.fn_org_entitlements($1) as e", [org], opcoes);
  return lerEntitlements(r.rows[0]!.e);
}

/**
 * O array `features` COMO A FUNÇÃO O DEVOLVE — sem passar por `lerEntitlements`,
 * que acrescenta `channels` por conta própria (camada 1) e esconderia uma
 * função que deixou de incluí-lo. A sabotagem do `union select 'channels'`
 * passou verde na primeira versão destes casos por exatamente isso.
 */
async function featuresCruas(org: string): Promise<string[]> {
  const r = await como<{ f: string[] }>(
    null,
    "select coalesce(array(select jsonb_array_elements_text(public.fn_org_entitlements($1) -> 'features')), '{}') as f",
    [org],
    { papel: "service_role" },
  );
  return [...r.rows[0]!.f].sort();
}

async function temNoBanco(org: string, feature: string): Promise<boolean> {
  const r = await como<{ t: boolean }>(null, "select public.fn_org_has_feature($1, $2) as t", [org, feature], { papel: "service_role" });
  return r.rows[0]!.t;
}

async function definirPlano(actor: string, org: string, plan: string, reason = "invariante") {
  const r = await como<{ r: { changed: boolean; from_plan_id: string | null; to_plan_id: string } }>(
    null,
    "select public.fn_definir_plano_da_organizacao($1, $2, $3, $4) as r",
    [actor, org, plan, reason],
    { papel: "service_role" },
  );
  return r.rows[0]!.r;
}

async function criarOverride(
  org: string,
  feature: string,
  mode: "enable" | "disable",
  janela: { starts?: string; ends?: string | null } = {},
  limits: Record<string, number | null> = {},
): Promise<string> {
  const r = await como<{ id: string }>(
    null,
    "select public.fn_criar_override_de_recurso($1, $2, $3, $4, $5, $6, $7, $8) as id",
    [PLATAFORMA, org, feature, mode, janela.starts ?? null, janela.ends ?? null, JSON.stringify(limits), "invariante"],
    { papel: "service_role" },
  );
  return r.rows[0]!.id;
}

async function revogarOverride(id: string, org = ORG_A): Promise<boolean> {
  const r = await como<{ ok: boolean }>(
    null,
    "select public.fn_revogar_override_de_recurso($1, $2, $3, $4) as ok",
    [PLATAFORMA, org, id, "invariante"],
    { papel: "service_role" },
  );
  return r.rows[0]!.ok;
}

async function limparOverrides(org: string) {
  await pool.query("delete from organization_feature_overrides where organization_id = $1", [org]);
}

let LEGADO = "";
let STARTER = "";
let INATIVO = "";

beforeAll(async () => {
  for (const u of [ADMIN_A, VIEWER_B, PLATAFORMA, PLATAFORMA_RO]) {
    await pool.query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [u, `${u}@entitlements.test`]);
  }
  await pool.query(
    `insert into platform_admins (user_id, granted_by, scope, mfa_required, reason)
     values ($1, $1, 'full', false, 'Invariante entitlements'), ($2, $2, 'support_readonly', false, 'Invariante entitlements')
     on conflict (user_id) do nothing`,
    [PLATAFORMA, PLATAFORMA_RO],
  );

  const legado = await pool.query<{ id: string }>("select id from platform_plans where slug = 'legado'");
  LEGADO = legado.rows[0]!.id;

  const starter = await pool.query<{ id: string }>(
    `insert into platform_plans (slug, name, limits) values ('e17e-starter', 'Starter (invariante)', '{"max_users": 5, "max_ai_agents": 0}')
     on conflict (slug) do update set limits = excluded.limits returning id`,
  );
  STARTER = starter.rows[0]!.id;
  await pool.query("insert into platform_plan_features (plan_id, feature) values ($1, 'inbox'), ($1, 'crm') on conflict do nothing", [STARTER]);

  const inativo = await pool.query<{ id: string }>(
    `insert into platform_plans (slug, name, is_active) values ('e17e-inativo', 'Inativo (invariante)', false)
     on conflict (slug) do update set is_active = false returning id`,
  );
  INATIVO = inativo.rows[0]!.id;

  for (const [org, slug] of [[ORG_A, "e17e-org-a"], [ORG_B, "e17e-org-b"]] as const) {
    await pool.query(
      `insert into organizations (id, slug, legal_name, display_name) values ($1, $2, 'Entitlements LTDA', 'Entitlements')
       on conflict (id) do nothing`,
      [org, slug],
    );
  }
  await pool.query(
    `insert into user_organizations (user_id, organization_id, role, accepted_at)
     values ($1, $2, 'admin', now()), ($3, $4, 'viewer', now()) on conflict do nothing`,
    [ADMIN_A, ORG_A, VIEWER_B, ORG_B],
  );
});

afterAll(async () => {
  await pool.end();
});

// ─── 1. CANAIS SEMPRE ────────────────────────────────────────────────────────

describe("canais sempre — as três camadas", () => {
  it("camada 3: o CHECK recusa um override que desligue channels (23514)", async () => {
    expect(await codigoDoErro(criarOverride(ORG_A, "channels", "disable"))).toBe("23514");
  });

  it("camada 3: channels também não é valor aceito em platform_plan_features (23514)", async () => {
    expect(
      await codigoDoErro(pool.query("insert into platform_plan_features (plan_id, feature) values ($1, 'channels')", [STARTER])),
    ).toBe("23514");
  });

  it("camada 2: plano SEM nenhum recurso + disable de tudo → a função ainda devolve channels", async () => {
    const vazio = await pool.query<{ id: string }>(
      "insert into platform_plans (slug, name) values ('e17e-vazio', 'Vazio (invariante)') on conflict (slug) do update set name = excluded.name returning id",
    );
    await definirPlano(PLATAFORMA, ORG_B, vazio.rows[0]!.id);
    await limparOverrides(ORG_B);
    for (const f of RECURSOS_VENDAVEIS) await criarOverride(ORG_B, f, "disable");

    expect(await featuresCruas(ORG_B), "a FUNÇÃO tem de incluir channels, não só o leitor TS").toEqual(["channels"]);
    const e = await entitlements(ORG_B);
    expect([...e.features]).toEqual(["channels"]);
    expect(await temNoBanco(ORG_B, "channels")).toBe(true);
    for (const f of RECURSOS_VENDAVEIS) expect(await temNoBanco(ORG_B, f), f).toBe(false);

    await limparOverrides(ORG_B);
    await definirPlano(PLATAFORMA, ORG_B, LEGADO);
  });

  it("camada 2: organização sem plano E sem padrão → origem 'nenhum', só channels — fechado e observável", async () => {
    // O único jeito de chegar aqui é tirar o padrão à mão. Simula-se isso
    // numa transação: o padrão sai, a organização nasce sem plano, mede-se,
    // e o rollback devolve o mundo.
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("update platform_plans set is_default = false where is_default");
      await c.query(
        "insert into organizations (id, slug, legal_name, display_name) values ($1, 'e17e-sem-padrao', 'X', 'X')",
        [ORG_SEM_PADRAO],
      );
      const linha = await c.query<{ plan_id: string | null }>("select plan_id from organizations where id = $1", [ORG_SEM_PADRAO]);
      expect(linha.rows[0]!.plan_id).toBeNull();
      const r = await c.query<{ e: unknown; t: boolean; f: boolean; cru: string[] }>(
        `select public.fn_org_entitlements($1) as e, public.fn_org_has_feature($1, 'channels') as t, public.fn_org_has_feature($1, 'crm') as f,
                coalesce(array(select jsonb_array_elements_text(public.fn_org_entitlements($1) -> 'features')), '{}') as cru`,
        [ORG_SEM_PADRAO],
      );
      expect(r.rows[0]!.cru, "a FUNÇÃO tem de devolver channels mesmo sem plano").toEqual(["channels"]);
      const e = lerEntitlements(r.rows[0]!.e);
      expect(e.origem).toBe("nenhum");
      expect(e.plan).toBeNull();
      expect([...e.features]).toEqual(["channels"]);
      expect(r.rows[0]!.t).toBe(true);
      expect(r.rows[0]!.f).toBe(false);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

// ─── 2. RESOLUÇÃO ────────────────────────────────────────────────────────────

describe("resolução — plano, padrão, overrides, limites", () => {
  it("o seed existe UMA vez e é o único padrão, mesmo depois de o baseline ser reaplicado", async () => {
    const r = await pool.query<{ legados: string; padroes: string; ativo: boolean }>(
      `select (select count(*) from platform_plans where slug = 'legado') as legados,
              (select count(*) from platform_plans where is_default) as padroes,
              (select is_active from platform_plans where slug = 'legado') as ativo`,
    );
    expect(r.rows[0]).toEqual({ legados: "1", padroes: "1", ativo: true });
    const f = await pool.query<{ n: string }>("select count(*) as n from platform_plan_features where plan_id = $1", [LEGADO]);
    expect(Number(f.rows[0]!.n)).toBe(RECURSOS_VENDAVEIS.length);
  });

  it("organização nova nasce no padrão pelo trigger (nenhum caminho de criação precisa saber do plano)", async () => {
    const r = await pool.query<{ plan_id: string; plan_assigned_at: string | null }>(
      "select plan_id, plan_assigned_at from organizations where id = $1",
      [ORG_A],
    );
    expect(r.rows[0]!.plan_id).toBe(LEGADO);
    expect(r.rows[0]!.plan_assigned_at).not.toBeNull();
    const e = await entitlements(ORG_A);
    expect(e.origem).toBe("atribuido");
    expect(e.plan?.slug).toBe("legado");
    expect([...e.features].sort()).toEqual([...RECURSOS].sort());
  });

  it("atribuir plano: features passam a ser as do plano ∪ channels; limites vêm do plano", async () => {
    const r = await definirPlano(PLATAFORMA, ORG_A, STARTER);
    expect(r).toMatchObject({ changed: true, from_plan_id: LEGADO, to_plan_id: STARTER });
    expect(await featuresCruas(ORG_A)).toEqual(["channels", "crm", "inbox"]);
    const e = await entitlements(ORG_A);
    expect([...e.features].sort()).toEqual(["channels", "crm", "inbox"]);
    expect(e.limits).toEqual({ max_users: 5, max_ai_agents: 0 });
    expect(temRecurso(e, "ai_agents")).toBe(false);
    expect(await temNoBanco(ORG_A, "crm")).toBe(true);
    expect(await temNoBanco(ORG_A, "broadcast")).toBe(false);
    // Idempotente: mesmo plano de novo → changed=false, sem mexer no carimbo.
    expect((await definirPlano(PLATAFORMA, ORG_A, STARTER)).changed).toBe(false);
  });

  it("override enable ativo liga o recurso e põe o limite dele por cima do plano", async () => {
    await limparOverrides(ORG_A);
    await criarOverride(ORG_A, "ai_agents", "enable", { ends: "2999-01-01T00:00:00Z" }, { max_ai_agents: 2 });
    const e = await entitlements(ORG_A);
    expect(temRecurso(e, "ai_agents")).toBe(true);
    expect(e.limits).toEqual({ max_users: 5, max_ai_agents: 2 });
    expect(e.overrides).toHaveLength(1);
    expect(e.overrides[0]!.ends_at).not.toBeNull();
    expect(await temNoBanco(ORG_A, "ai_agents")).toBe(true);
  });

  it("override vencido, futuro ou revogado NÃO conta — expiração é passiva, sem cron", async () => {
    await limparOverrides(ORG_A);
    await criarOverride(ORG_A, "broadcast", "enable", { starts: "2000-01-01T00:00:00Z", ends: "2000-02-01T00:00:00Z" });
    await criarOverride(ORG_A, "analytics", "enable", { starts: "2999-01-01T00:00:00Z" });
    const revogado = await criarOverride(ORG_A, "ai_agents", "enable");
    expect(await revogarOverride(revogado)).toBe(true);
    expect(await revogarOverride(revogado), "segunda revogação não carimba de novo").toBe(false);

    const e = await entitlements(ORG_A);
    expect([...e.features].sort()).toEqual(["channels", "crm", "inbox"]);
    expect(e.overrides).toEqual([]);
    const linha = await pool.query<{ revoked_at: string | null; revoked_by: string }>(
      "select revoked_at, revoked_by from organization_feature_overrides where id = $1",
      [revogado],
    );
    expect(linha.rows[0]!.revoked_at).not.toBeNull();
    expect(linha.rows[0]!.revoked_by).toBe(PLATAFORMA);
  });

  it("disable ativo tira recurso que o plano dá, e vence um enable ativo do mesmo recurso", async () => {
    await limparOverrides(ORG_A);
    await criarOverride(ORG_A, "inbox", "disable");
    await criarOverride(ORG_A, "ai_agents", "enable");
    await criarOverride(ORG_A, "ai_agents", "disable");
    const e = await entitlements(ORG_A);
    expect([...e.features].sort()).toEqual(["channels", "crm"]);
    expect(await temNoBanco(ORG_A, "inbox")).toBe(false);
    expect(await temNoBanco(ORG_A, "ai_agents")).toBe(false);
  });

  it("limites: o override mais novo vence por chave, e null remove o limite do plano", async () => {
    await limparOverrides(ORG_A);
    await criarOverride(ORG_A, "ai_agents", "enable", {}, { max_ai_agents: 1 });
    await criarOverride(ORG_A, "ai_agents", "enable", {}, { max_ai_agents: 3, max_users: null });
    const e = await entitlements(ORG_A);
    expect(e.limits).toEqual({ max_users: null, max_ai_agents: 3 });
  });

  it("plano inativo não recebe organização (23514); quem já está nele continua com os recursos", async () => {
    await limparOverrides(ORG_A);
    expect(await codigoDoErro(definirPlano(PLATAFORMA, ORG_A, INATIVO))).toBe("23514");

    // Quem já está: liga o plano, atribui, desativa — a organização não perde nada.
    await pool.query("update platform_plans set is_active = true where id = $1", [INATIVO]);
    await pool.query("insert into platform_plan_features (plan_id, feature) values ($1, 'analytics') on conflict do nothing", [INATIVO]);
    await definirPlano(PLATAFORMA, ORG_A, INATIVO);
    await pool.query("update platform_plans set is_active = false where id = $1", [INATIVO]);
    const e = await entitlements(ORG_A);
    expect(e.plan?.is_active).toBe(false);
    expect([...e.features].sort()).toEqual(["analytics", "channels"]);

    await definirPlano(PLATAFORMA, ORG_A, STARTER);
  });

  it("o padrão não pode ser desativado (23514) e um plano com organização não pode ser apagado (23503)", async () => {
    expect(await codigoDoErro(pool.query("update platform_plans set is_active = false where id = $1", [LEGADO]))).toBe("23514");
    expect(await codigoDoErro(pool.query("delete from platform_plans where id = $1", [STARTER]))).toBe("23503");
  });
});

// ─── 3. RLS E ESCRITA ────────────────────────────────────────────────────────

describe("RLS e escrita — quem lê o quê, quem escreve por onde", () => {
  it("plan_id não muda por UPDATE direto — nem de service_role, nem do dono do banco", async () => {
    expect(
      await codigoDoErro(como(null, "update organizations set plan_id = $1 where id = $2", [LEGADO, ORG_A], { papel: "service_role" })),
    ).toBe("42501");
    expect(await codigoDoErro(pool.query("update organizations set plan_id = $1 where id = $2", [LEGADO, ORG_A]))).toBe("42501");
    // …e um UPDATE que NÃO toca plan_id (o caso de updateTenant) segue livre.
    await pool.query("update organizations set display_name = 'Entitlements 2' where id = $1", [ORG_A]);
    const r = await pool.query<{ plan_id: string }>("select plan_id from organizations where id = $1", [ORG_A]);
    expect(r.rows[0]!.plan_id).toBe(STARTER);
  });

  it("as funções de escrita exigem platform admin FULL: viewer, admin do tenant e support_readonly levam 42501", async () => {
    for (const ator of [VIEWER_B, ADMIN_A, PLATAFORMA_RO]) {
      expect(await codigoDoErro(definirPlano(ator, ORG_A, LEGADO)), `definir como ${ator}`).toBe("42501");
      expect(
        await codigoDoErro(
          como(null, "select public.fn_criar_override_de_recurso($1, $2, 'crm', 'enable', null, null, '{}', 'x')", [ator, ORG_A], { papel: "service_role" }),
        ),
        `override como ${ator}`,
      ).toBe("42501");
    }
  });

  it("authenticated não tem EXECUTE nas funções de escrita, nem INSERT/UPDATE/DELETE nas tabelas", async () => {
    expect(
      await codigoDoErro(como(ADMIN_A, "select public.fn_definir_plano_da_organizacao($1, $2, $3, 'x')", [ADMIN_A, ORG_A, LEGADO])),
    ).toBe("42501");
    expect(
      await codigoDoErro(como(ADMIN_A, "insert into organization_feature_overrides (organization_id, feature, mode, reason) values ($1, 'crm', 'enable', 'x')", [ORG_A])),
    ).toBe("42501");
    expect(await codigoDoErro(como(ADMIN_A, "insert into platform_plans (slug, name) values ('e17e-hack', 'x')"))).toBe("42501");
    expect(await codigoDoErro(como(ADMIN_A, "update platform_plans set name = 'x' where id = $1", [STARTER]))).toBe("42501");
    expect(await codigoDoErro(como(ADMIN_A, "delete from organization_feature_overrides where organization_id = $1", [ORG_A]))).toBe("42501");
  });

  it("catálogo: o tenant não vê platform_plans; o platform admin vê", async () => {
    const tenant = await como<{ n: string }>(ADMIN_A, "select count(*) as n from platform_plans");
    expect(tenant.rows[0]!.n).toBe("0");
    const feats = await como<{ n: string }>(ADMIN_A, "select count(*) as n from platform_plan_features");
    expect(feats.rows[0]!.n).toBe("0");
    const plataforma = await como<{ n: string }>(PLATAFORMA, "select count(*) as n from platform_plans");
    expect(Number(plataforma.rows[0]!.n)).toBeGreaterThanOrEqual(3);
  });

  it("overrides: membro lê os da própria organização e nenhum de outra; platform admin lê todos", async () => {
    await limparOverrides(ORG_A);
    await limparOverrides(ORG_B);
    await criarOverride(ORG_A, "ai_agents", "enable");
    await criarOverride(ORG_B, "broadcast", "enable");

    const a = await como<{ org: string }>(ADMIN_A, "select organization_id as org from organization_feature_overrides");
    expect(a.rows.map((r) => r.org)).toEqual([ORG_A]);
    const b = await como<{ org: string }>(VIEWER_B, "select organization_id as org from organization_feature_overrides");
    expect(b.rows.map((r) => r.org)).toEqual([ORG_B]);
    const p = await como<{ n: string }>(PLATAFORMA, "select count(*) as n from organization_feature_overrides where organization_id in ($1, $2)", [ORG_A, ORG_B]);
    expect(p.rows[0]!.n).toBe("2");
  });

  it("fn_org_entitlements: membro e platform admin perguntam; membro de OUTRA organização leva 42501; anon não executa", async () => {
    const e = await entitlements(ORG_A, ADMIN_A, { papel: "authenticated" });
    expect(e.plan?.slug).toBe("e17e-starter");
    expect(temRecurso(e, "ai_agents")).toBe(true); // o override do caso anterior
    const p = await entitlements(ORG_A, PLATAFORMA, { papel: "authenticated" });
    expect(p.plan?.slug).toBe("e17e-starter");
    expect(await codigoDoErro(entitlements(ORG_A, VIEWER_B, { papel: "authenticated" }))).toBe("42501");
    expect(
      await codigoDoErro(como(VIEWER_B, "select public.fn_org_has_feature($1, 'crm')", [ORG_A])),
    ).toBe("42501");
    expect(await codigoDoErro(entitlements(ORG_A, null, { papel: "anon" }))).toBe("42501");
  });

  it("toda função nova é security definer sem EXECUTE para anon nem public", async () => {
    const r = await pool.query<{ nome: string; anon: boolean; pub: boolean }>(
      `select p.oid::regprocedure::text as nome,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('public', p.oid, 'EXECUTE') as pub
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('fn_org_entitlements','fn_org_has_feature','fn_definir_plano_da_organizacao',
                            'fn_criar_override_de_recurso','fn_revogar_override_de_recurso','fn_exigir_platform_admin_full')`,
    );
    expect(r.rows.length).toBe(6);
    for (const f of r.rows) {
      expect(f.anon, `${f.nome} executável por anon`).toBe(false);
      expect(f.pub, `${f.nome} executável por public`).toBe(false);
    }
  });
});
