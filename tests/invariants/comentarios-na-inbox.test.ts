import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { countAs, GOV_ADMIN, GOV_ORG, GOV_SESSION, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * COMENTÁRIOS NA INBOX (migration 0285, spec 22) — o que o schema promete.
 *
 *   1. Direct e comentário convivem: a mesma pessoa, na mesma conexão, tem UMA
 *      conversa de Direct e UMA por comentário principal.
 *   2. `fn_upsert_comment_conversation` reencontra o fio pela raiz, recusa
 *      conexão de WhatsApp e não é alcançável pela REST.
 *   3. Quem escolhe "a conversa do contato" (atendimento, comando) só enxerga
 *      Direct — senão uma automação responderia em público.
 *   4. O que a conexão entrega: comentário só em rede social, e nunca nada.
 *   5. O bloco B2 do baseline, que o update.sh reaplica, NÃO funde nem apaga
 *      fio de comentário — o texto é LIDO do baseline e executado aqui.
 *   6. Isolamento: membro da organização vizinha não vê o fio.
 *
 * Cada negativa tem o controle positivo ao lado.
 */

const ORG_B = "eeeeeeee-0000-4000-8000-000000000001";
const MEMBRO_B = "eeeeeeee-1111-4000-8000-000000000001";
const SESSAO_IG = "eeeeeeee-2222-4000-8000-000000000001";

const BASELINE = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");

function falha(script: string): string {
  try {
    sql(script);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

function valor(script: string): string {
  return lastLine(sql(script));
}

let contato = "";

function fio(raiz: string, sessao = SESSAO_IG, contexto = "{}"): string {
  return valor(
    `select public.fn_upsert_comment_conversation('${GOV_ORG}', '${contato}', '${sessao}', '${raiz}', '${contexto}'::jsonb)::text;`,
  );
}

function direct(): string {
  return valor(`select public.fn_upsert_wa_conversation('${GOV_ORG}', '${contato}', '${SESSAO_IG}')::text;`);
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO_B}', 'comentarios-b@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'comentarios-inv-b', 'Comentarios Invariant Org B', 'Coment Inv B') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    insert into public.channel_sessions (id, organization_id, provider, platform, zernio_account_id, webhook_secret_encrypted, inbox_comments)
      values ('${SESSAO_IG}', '${GOV_ORG}', 'zernio', 'instagram', 'acc-comentarios-a', '\\x00'::bytea, true)
      on conflict do nothing;
  `);
  contato = valor(
    `select public.fn_upsert_social_contact('${GOV_ORG}', 'instagram', 'igsid-comenta', '${SESSAO_IG}', 'quem_comenta', null)::text;`,
  );
});

describe("Direct e comentário convivem na mesma conexão", () => {
  it("o Direct continua um só por contato e conexão (controle positivo do índice)", () => {
    expect(direct()).toBe(direct());
  });

  it("cada comentário principal é um fio próprio, separado do Direct", () => {
    const d = direct();
    const a = fio("comentario-raiz-a");
    const b = fio("comentario-raiz-b");
    expect(a).not.toBe(d);
    expect(b).not.toBe(d);
    expect(a).not.toBe(b);
    expect(valor(`select kind from public.conversations where id = '${a}';`)).toBe("comment");
    expect(valor(`select kind from public.conversations where id = '${d}';`)).toBe("direct");
  });

  it("a mesma raiz devolve o mesmo fio e completa o contexto do post", () => {
    const primeiro = fio("comentario-raiz-c", SESSAO_IG, '{"permalink":"https://instagram.com/p/x"}');
    const segundo = fio("comentario-raiz-c", SESSAO_IG, '{"post_text":"Promo"}');
    expect(segundo).toBe(primeiro);
    expect(valor(`select metadata->'comentario'->>'permalink' from public.conversations where id = '${primeiro}';`)).toBe(
      "https://instagram.com/p/x",
    );
    expect(valor(`select metadata->'comentario'->>'post_text' from public.conversations where id = '${primeiro}';`)).toBe("Promo");
  });

  it("o fio nasce com a rede da conexão e a raiz em provider_conversation_id", () => {
    const id = fio("comentario-raiz-d");
    expect(valor(`select channel || '|' || provider_conversation_id from public.conversations where id = '${id}';`)).toBe(
      "instagram|comentario-raiz-d",
    );
  });
});

describe("fn_upsert_comment_conversation — guardas", () => {
  it("recusa conexão de WhatsApp", () => {
    const erro = falha(
      `select public.fn_upsert_comment_conversation('${GOV_ORG}', '${contato}', '${GOV_SESSION}', 'raiz-wa', '{}'::jsonb);`,
    );
    expect(erro).toMatch(/comment_session_not_social/);
  });

  it("recusa raiz vazia", () => {
    expect(falha(`select public.fn_upsert_comment_conversation('${GOV_ORG}', '${contato}', '${SESSAO_IG}', ' ', '{}'::jsonb);`)).toMatch(
      /comment_root_required/,
    );
  });

  it("recusa conexão de outra organização", () => {
    const erro = falha(
      `select public.fn_upsert_comment_conversation('${ORG_B}', '${contato}', '${SESSAO_IG}', 'raiz-x', '{}'::jsonb);`,
    );
    expect(erro).toMatch(/comment_session_not_social/);
  });

  it("authenticated e anon não executam", () => {
    for (const papel of ["authenticated", "anon"]) {
      expect(
        valor(
          `select has_function_privilege('${papel}', 'public.fn_upsert_comment_conversation(uuid, uuid, uuid, text, jsonb)', 'execute')::text;`,
        ),
      ).toBe("false");
    }
    expect(
      valor(
        `select has_function_privilege('service_role', 'public.fn_upsert_comment_conversation(uuid, uuid, uuid, text, jsonb)', 'execute')::text;`,
      ),
    ).toBe("true");
  });
});

describe("quem escolhe 'a conversa do contato' só enxerga Direct", () => {
  it("fn_service_observe aponta o Direct mesmo com um fio de comentário mais recente", () => {
    const d = direct();
    const c = fio("comentario-raiz-recente");
    sql(`update public.conversations set last_message_at = now() - interval '1 day' where id = '${d}';
         update public.conversations set last_message_at = now() where id = '${c}';`);
    expect(valor(`select public.fn_service_observe('${GOV_ORG}', '${contato}')->>'conversation_id';`)).toBe(d);
  });

  it("fn_service_begin abre atendimento no Direct, não no comentário", () => {
    const d = direct();
    fio("comentario-raiz-begin");
    expect(valor(`select public.fn_service_begin('${GOV_ORG}', '${contato}', '${SESSAO_IG}', null)->>'conversation_id';`)).toBe(d);
  });

  it("fn_service_observe_command mostra o Direct como destino da conexão", () => {
    const d = direct();
    const destino = valor(
      `select d->'observed'->>'conversation_id' from jsonb_array_elements(public.fn_service_observe_command('${GOV_ORG}', '${contato}')->'destinations') d where d->>'channel_session_id' = '${SESSAO_IG}';`,
    );
    expect(destino).toBe(d);
  });
});

describe("o que a conexão entrega para a inbox", () => {
  it("conexão nova sem dizer nada: Direct ligado, comentários desligados", () => {
    expect(valor(`select inbox_direct::text || '|' || inbox_comments::text from public.channel_sessions where id = '${GOV_SESSION}';`)).toBe(
      "true|false",
    );
  });

  it("WhatsApp não liga comentários", () => {
    expect(falha(`update public.channel_sessions set inbox_comments = true where id = '${GOV_SESSION}';`)).toMatch(
      /channel_sessions_inbox_comments_social_check/,
    );
  });

  it("conexão que não entrega nada é recusada", () => {
    expect(falha(`update public.channel_sessions set inbox_direct = false, inbox_comments = false where id = '${SESSAO_IG}';`)).toMatch(
      /channel_sessions_inbox_entrega_algo_check/,
    );
  });

  it("rede social com só comentários é aceita (controle positivo)", () => {
    expect(falha(`update public.channel_sessions set inbox_direct = false, inbox_comments = true where id = '${SESSAO_IG}';`)).toBe("");
    sql(`update public.channel_sessions set inbox_direct = true where id = '${SESSAO_IG}';`);
  });

  it("tipo de conversa fora do vocabulário é recusado", () => {
    expect(falha(`update public.conversations set kind = 'story' where id = '${direct()}';`)).toMatch(/conversations_kind_check/);
  });
});

describe("o B2 do baseline (reaplicado pelo update.sh) não apaga fio de comentário", () => {
  it("reaplica o bloco e os fios continuam de pé", () => {
    const inicio = BASELINE.indexOf("-- B2. Merge de conversas 1:1 duplicadas");
    const fim = BASELINE.indexOf("-- C. Constraints anti-reduplicação", inicio);
    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    const b2 = BASELINE.slice(inicio, fim);

    const fios = Number(valor(`select count(*) from public.conversations where contact_id = '${contato}' and kind = 'comment';`));
    expect(fios).toBeGreaterThan(1);
    sql(b2);
    expect(Number(valor(`select count(*) from public.conversations where contact_id = '${contato}' and kind = 'comment';`))).toBe(fios);
  });

  it("controle: sem o filtro de Direct o mesmo bloco APAGARIA os fios", () => {
    const inicio = BASELINE.indexOf("-- B2. Merge de conversas 1:1 duplicadas");
    const fim = BASELINE.indexOf("-- C. Constraints anti-reduplicação", inicio);
    const semFiltro = BASELINE.slice(inicio, fim).replaceAll("is_group = false and kind = 'direct'", "is_group = false");
    // Só a contagem do que SERIA apagado — o delete de verdade fica no bloco certo.
    const conta = semFiltro.slice(semFiltro.lastIndexOf("delete from public.conversations d"));
    const selecao = conta.slice(conta.indexOf("(select id,"), conta.indexOf(") canon") + 1);
    const apagaria = Number(valor(`select count(*) from ${selecao} canon where canon.id <> canon.canonical_id and canon.id in (select id from public.conversations where contact_id = '${contato}');`));
    expect(apagaria).toBeGreaterThan(0);
  });
});

describe("isolamento", () => {
  it("membro da organização lê o fio (controle positivo)", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.conversations where kind = 'comment' and contact_id = '${contato}'`)).toBeGreaterThan(0);
  });

  it("membro da vizinha não lê", () => {
    expect(countAs(MEMBRO_B, `select count(*) from public.conversations where kind = 'comment' and contact_id = '${contato}'`)).toBe(0);
  });
});
