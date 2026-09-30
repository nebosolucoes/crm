import { beforeAll, describe, expect, it } from "vitest";

import { countAs, GOV_AGENT_A, GOV_ADMIN, GOV_ORG, GOV_SESSION, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * CANAIS SOCIAIS (migration 0280, spec 21) — o que o schema promete.
 *
 * Medido sob o papel real (`set role authenticated` + claims do JWT), nunca
 * lendo catálogo:
 *
 *   1. `contact_platform_identities`: membro lê as da própria organização e
 *      NÃO as da vizinha; ninguém do PostgREST escreve (a escrita é da RPC).
 *   3. `fn_upsert_social_contact`: reencontra a mesma pessoa, separa por
 *      organização, recusa rede desconhecida e não é alcançável por
 *      `authenticated`.
 *   4. Plataforma da sessão: default `whatsapp`; rede que não é WhatsApp só
 *      pelo intermediário; a conversa nasce com a rede da sessão.
 *
 * Cada negativa tem o controle positivo ao lado.
 */

const ORG_B = "dddddddd-0000-4000-8000-000000000001";
const MEMBRO_B = "dddddddd-1111-4000-8000-000000000001";
const SESSAO_IG = "dddddddd-2222-4000-8000-000000000001";
const SESSAO_IG_B = "dddddddd-2222-4000-8000-000000000002";

function falha(script: string): string {
  try {
    sql(script);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

function comoUsuario(userId: string, script: string): string {
  return falha(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${script}
  `);
}

function upsert(org: string, platform: string, userId: string, sessao: string | null, username: string | null): string {
  const s = (v: string | null) => (v === null ? "null" : `'${v}'`);
  return lastLine(
    sql(
      `select coalesce(public.fn_upsert_social_contact('${org}', '${platform}', '${userId}', ${s(sessao)}, ${s(username)}, null)::text, '');`,
    ),
  );
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO_B}', 'social-b@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'social-inv-b', 'Social Invariant Org B', 'Social Inv B') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, provider, platform, zernio_account_id, webhook_secret_encrypted)
      values ('${SESSAO_IG}',   '${GOV_ORG}', 'zernio', 'instagram', 'acc-social-a', '\\x00'::bytea),
             ('${SESSAO_IG_B}', '${ORG_B}',   'zernio', 'instagram', 'acc-social-b', '\\x00'::bytea)
      on conflict do nothing;
    insert into public.organization_limit_extras (organization_id, limit_key, quantidade, reason)
      values ('${GOV_ORG}', 'max_instagram', 2, 'extra vendido (invariante)');
  `);
  upsert(GOV_ORG, "instagram", "igsid-a", SESSAO_IG, "pessoa_a");
  upsert(ORG_B, "instagram", "igsid-b", SESSAO_IG_B, "pessoa_b");
});

describe("contact_platform_identities — isolamento por organização", () => {
  it("membro lê a identidade da própria organização (controle positivo)", () => {
    expect(countAs(GOV_AGENT_A, "select count(*) from public.contact_platform_identities where platform_user_id = 'igsid-a'")).toBe(1);
  });

  it("membro NÃO lê a identidade da organização vizinha", () => {
    expect(countAs(GOV_AGENT_A, "select count(*) from public.contact_platform_identities where platform_user_id = 'igsid-b'")).toBe(0);
    expect(countAs(MEMBRO_B, "select count(*) from public.contact_platform_identities where platform_user_id = 'igsid-a'")).toBe(0);
  });

  it("nem admin escreve pela REST — a escrita é da RPC do service role", () => {
    const erro = comoUsuario(
      GOV_ADMIN,
      `update public.contact_platform_identities set username = 'x' where platform_user_id = 'igsid-a';`,
    );
    expect(erro).toMatch(/permission denied/);
  });
});

describe("organization_limit_extras — conexões extras por empresa (0281)", () => {
  it("membro lê o extra da própria organização (controle positivo)", () => {
    expect(countAs(GOV_AGENT_A, "select count(*) from public.organization_limit_extras where limit_key = 'max_instagram'")).toBeGreaterThan(0);
  });

  it("membro da vizinha NÃO lê", () => {
    expect(countAs(MEMBRO_B, "select count(*) from public.organization_limit_extras")).toBe(0);
  });

  it("nem admin da organização escreve pela REST — quem vende o extra é o admin da instalação", () => {
    const erro = comoUsuario(
      GOV_ADMIN,
      `insert into public.organization_limit_extras (organization_id, limit_key, quantidade, reason) values ('${GOV_ORG}', 'max_instagram', 50, 'eu mesmo');`,
    );
    expect(erro).toMatch(/permission denied/);
  });

  it("chave fora do vocabulário é recusada pelo banco", () => {
    const erro = falha(
      `insert into public.organization_limit_extras (organization_id, limit_key, quantidade, reason) values ('${GOV_ORG}', 'max_users', 1, 'x');`,
    );
    expect(erro).toMatch(/organization_limit_extras_key_check/);
  });
});

describe("fn_upsert_social_contact", () => {
  it("a mesma pessoa volta ao mesmo contato, e o @usuário se atualiza", () => {
    const c1 = upsert(GOV_ORG, "instagram", "igsid-repete", SESSAO_IG, "antes");
    const c2 = upsert(GOV_ORG, "instagram", "igsid-repete", SESSAO_IG, "depois");
    expect(c1).not.toBe("");
    expect(c2).toBe(c1);
    expect(lastLine(sql(`select username from public.contact_platform_identities where platform_user_id = 'igsid-repete';`))).toBe("depois");
  });

  it("o mesmo id em outra organização é outra pessoa", () => {
    const a = upsert(GOV_ORG, "messenger", "psid-igual", null, null);
    const b = upsert(ORG_B, "messenger", "psid-igual", null, null);
    expect(a).not.toBe("");
    expect(b).not.toBe("");
    expect(a).not.toBe(b);
  });

  it("rede desconhecida não cria contato", () => {
    expect(upsert(GOV_ORG, "tiktok", "qualquer", null, null)).toBe("");
  });

  it("não é alcançável por authenticated", () => {
    const erro = comoUsuario(
      GOV_ADMIN,
      `select public.fn_upsert_social_contact('${GOV_ORG}', 'instagram', 'x', null, null, null);`,
    );
    expect(erro).toMatch(/permission denied/);
  });
});

describe("plataforma da sessão e da conversa", () => {
  it("sessão existente é de WhatsApp pelo default", () => {
    expect(lastLine(sql(`select platform from public.channel_sessions where id = '${GOV_SESSION}';`))).toBe("whatsapp");
  });

  it("rede que não é WhatsApp só pelo intermediário", () => {
    const erro = falha(`
      insert into public.channel_sessions (organization_id, provider, platform, waha_session_name, webhook_secret_encrypted)
      values ('${GOV_ORG}', 'waha', 'instagram', 'waha-de-instagram', '\\x00'::bytea);
    `);
    expect(erro).toMatch(/channel_sessions_platform_provider_check/);
  });

  it("a conversa nasce com a rede da sessão", () => {
    const contato = upsert(GOV_ORG, "instagram", "igsid-conversa", SESSAO_IG, null);
    const conversa = lastLine(sql(`select public.fn_upsert_wa_conversation('${GOV_ORG}', '${contato}', '${SESSAO_IG}');`));
    expect(lastLine(sql(`select channel from public.conversations where id = '${conversa}';`))).toBe("instagram");
  });
});
