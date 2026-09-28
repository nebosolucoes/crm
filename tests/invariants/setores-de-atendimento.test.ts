import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_MANAGER,
  GOV_ORG,
  GOV_SESSION,
  lastLine,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * SETORES DE ATENDIMENTO (migration 0278, spec 20) — o que o schema promete.
 *
 * Quatro perguntas, cada uma medida sob o papel real (`set role authenticated`
 * + claims do JWT), nunca lendo catálogo:
 *
 *   1. Tenant: setor e membro de A não aparecem para B, mesmo com o mesmo slug.
 *   2. Visibilidade: agent de fora do setor não lê a conversa (nem as mensagens
 *      dela); membro lê; dono direto lê mesmo fora do setor; setor `scope='all'`
 *      lê tudo; manager lê tudo; conversa SEM setor segue `visibility_mode`;
 *      setor INATIVO cai na regra antiga.
 *   3. Escrita: a RPC de atribuição recusa quem não vê a conversa — a RLS
 *      esconde a linha da lista, mas a RPC recebe o id; o roteamento não entrega
 *      conversa de setor a quem não é membro.
 *   4. Passagem de bastão: quem transferiu continua vendo até o novo dono
 *      mandar a PRIMEIRA mensagem; mensagem de quem passa o bastão não encerra;
 *      transferir para setor zera o dono, guarda o bastão, grava o evento,
 *      reabre o roteamento e é idempotente.
 *
 * Cada negativa tem o controle positivo ao lado: uma função que lançasse sempre
 * (ou não existisse) deixaria a suíte verde pelo motivo errado.
 */

const ORG_B = "eeeeeeee-0000-4000-8000-000000000001";
const AGENT_B2 = "eeeeeeee-1111-4000-8000-000000000001";
/** Agent da GOV_ORG, membro do setor de supervisão (scope=all). */
const AGENT_C = "eeeeeeee-1111-4000-8000-000000000002";
const SESSION_B = "eeeeeeee-2222-4000-8000-000000000001";
const FIN = "eeeeeeee-3333-4000-8000-000000000001";
const COM = "eeeeeeee-3333-4000-8000-000000000002";
const SUP = "eeeeeeee-3333-4000-8000-000000000003";
const FIN_B = "eeeeeeee-3333-4000-8000-000000000004";
const CONTATO = (n: number) => `eeeeeeee-4444-4000-8000-00000000000${n}`;
/** FIN, sem dono. */
const CONV_FIN = "eeeeeeee-5555-4000-8000-000000000001";
/** COM, dona: GOV_AGENT_B. */
const CONV_COM = "eeeeeeee-5555-4000-8000-000000000002";
/** Sem setor, sem dono. */
const CONV_NONE = "eeeeeeee-5555-4000-8000-000000000003";
/** COM, mas dona: GOV_AGENT_A (que é do FIN). */
const CONV_COM_TO_A = "eeeeeeee-5555-4000-8000-000000000004";
/** Org B, setor FIN_B. */
const CONV_B = "eeeeeeee-5555-4000-8000-000000000005";
/** FIN, sem dono — reservada ao roteamento. */
const CONV_FIN_ROUTING = "eeeeeeee-5555-4000-8000-000000000006";
/** FIN, sem dono — reservada à recusa da transferência de setor. */
const CONV_FIN_FORBIDDEN = "eeeeeeee-5555-4000-8000-000000000007";

function asUser(userId: string, script: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${script}
  `);
}

/** Devolve o stderr da falha (ou "" se não falhou) — para medir a recusa pelo código dela. */
function falhaComo(userId: string, script: string): string {
  try {
    asUser(userId, script);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

function falhaComoServico(script: string): string {
  try {
    sql(script);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

function conversa(id: string): { sector_id: string | null; assigned_to_user_id: string | null; handover_from_user_id: string | null; status: string } {
  const out = sql(`select coalesce(sector_id::text,''), coalesce(assigned_to_user_id::text,''), coalesce(handover_from_user_id::text,''), status
                     from public.conversations where id = '${id}';`);
  const [sector, assigned, handover, status] = lastLine(out).split("|");
  return {
    sector_id: sector || null,
    assigned_to_user_id: assigned || null,
    handover_from_user_id: handover || null,
    status: status ?? "",
  };
}

function mensagem(conv: string, contato: string, sentBy: string | null, org = GOV_ORG, session = GOV_SESSION): void {
  sql(`
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via, sent_by_user_id)
    values ('${org}', '${conv}', '${session}', '${contato}', 'text', 'outbound', 'sent', 'oi', 'crm', ${sentBy ? `'${sentBy}'` : "null"});
  `);
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values
      ('${AGENT_B2}', 'set-agent-b2@invariant.test'),
      ('${AGENT_C}',  'set-agent-c@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'set-inv-b', 'Setores Invariant Org B', 'Set Inv B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${AGENT_B2}', '${ORG_B}',   'agent', now()),
      ('${AGENT_C}',  '${GOV_ORG}', 'agent', now())
      on conflict do nothing;
    do $set$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSION_B}', '${ORG_B}', 'set-inv-b', '\\x00'::bytea);
    exception when unique_violation then null; end $set$;

    insert into public.sectors (id, organization_id, name, slug, description, scope) values
      ('${FIN}',   '${GOV_ORG}', 'Financeiro',  'financeiro', 'boletos e cobrança', 'own'),
      ('${COM}',   '${GOV_ORG}', 'Comercial',   'comercial',  'orçamentos',         'own'),
      ('${SUP}',   '${GOV_ORG}', 'Supervisão',  'supervisao', 'vê tudo',            'all'),
      ('${FIN_B}', '${ORG_B}',   'Financeiro',  'financeiro', 'a outra org',        'own')
      on conflict do nothing;
    update public.sectors set is_active = true where id in ('${FIN}', '${COM}', '${SUP}', '${FIN_B}');
    insert into public.sector_members (organization_id, sector_id, user_id) values
      ('${GOV_ORG}', '${FIN}',   '${GOV_AGENT_A}'),
      ('${GOV_ORG}', '${COM}',   '${GOV_AGENT_B}'),
      ('${GOV_ORG}', '${SUP}',   '${AGENT_C}'),
      ('${ORG_B}',   '${FIN_B}', '${AGENT_B2}')
      on conflict do nothing;

    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO(1)}', '${GOV_ORG}', 'Setores Contato 1'),
      ('${CONTATO(2)}', '${GOV_ORG}', 'Setores Contato 2'),
      ('${CONTATO(3)}', '${GOV_ORG}', 'Setores Contato 3'),
      ('${CONTATO(4)}', '${GOV_ORG}', 'Setores Contato 4'),
      ('${CONTATO(5)}', '${ORG_B}',   'Setores Contato 5'),
      ('${CONTATO(6)}', '${GOV_ORG}', 'Setores Contato 6'),
      ('${CONTATO(7)}', '${GOV_ORG}', 'Setores Contato 7')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, sector_id, assigned_to_user_id, assigned_at) values
      ('${CONV_FIN}',           '${GOV_ORG}', '${CONTATO(1)}', '${GOV_SESSION}', 'open',    '${FIN}',   null,              null),
      ('${CONV_COM}',           '${GOV_ORG}', '${CONTATO(2)}', '${GOV_SESSION}', 'claimed', '${COM}',   '${GOV_AGENT_B}',  now()),
      ('${CONV_NONE}',          '${GOV_ORG}', '${CONTATO(3)}', '${GOV_SESSION}', 'open',    null,       null,              null),
      ('${CONV_COM_TO_A}',      '${GOV_ORG}', '${CONTATO(4)}', '${GOV_SESSION}', 'claimed', '${COM}',   '${GOV_AGENT_A}',  now()),
      ('${CONV_B}',             '${ORG_B}',   '${CONTATO(5)}', '${SESSION_B}',   'open',    '${FIN_B}', null,              null),
      ('${CONV_FIN_ROUTING}',   '${GOV_ORG}', '${CONTATO(6)}', '${GOV_SESSION}', 'open',    '${FIN}',   null,              null),
      ('${CONV_FIN_FORBIDDEN}', '${GOV_ORG}', '${CONTATO(7)}', '${GOV_SESSION}', 'open',    '${FIN}',   null,              null)
      on conflict do nothing;
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body)
      select organization_id, id, channel_session_id, contact_id, 'text', 'inbound', 'received', 'olá'
        from public.conversations where id in ('${CONV_FIN}', '${CONV_COM}')
          and not exists (select 1 from public.messages m where m.conversation_id = conversations.id);
  `);
});

describe("tenant: setor e membro não vazam entre organizações", () => {
  it("o agent da org B lê 0 setores e 0 membros da org A, e lê os seus", () => {
    expect(countAs(AGENT_B2, `select count(*) from public.sectors where organization_id = '${GOV_ORG}';`)).toBe(0);
    expect(countAs(AGENT_B2, `select count(*) from public.sector_members where organization_id = '${GOV_ORG}';`)).toBe(0);
    expect(countAs(AGENT_B2, `select count(*) from public.sectors where organization_id = '${ORG_B}';`)).toBe(1);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.sectors where organization_id = '${GOV_ORG}';`)).toBe(3);
  });

  it("agent não escreve setor; manager escreve", () => {
    const negado = falhaComo(GOV_AGENT_A, `insert into public.sectors (organization_id, name, slug) values ('${GOV_ORG}', 'Intruso', 'intruso');`);
    expect(negado).toContain("row-level security");
    asUser(GOV_MANAGER, `insert into public.sectors (organization_id, name, slug) values ('${GOV_ORG}', 'Suporte', 'suporte') on conflict do nothing;`);
    expect(countAs(GOV_MANAGER, `select count(*) from public.sectors where organization_id = '${GOV_ORG}' and slug = 'suporte';`)).toBe(1);
    sql(`delete from public.sectors where organization_id = '${GOV_ORG}' and slug = 'suporte';`);
  });

  it("FK composta recusa conversa e membro apontando para setor de outra organização", () => {
    expect(falhaComoServico(`update public.conversations set sector_id = '${FIN_B}' where id = '${CONV_NONE}';`)).toContain("conversations_sector_fk");
    expect(falhaComoServico(`insert into public.sector_members (organization_id, sector_id, user_id) values ('${GOV_ORG}', '${FIN_B}', '${GOV_AGENT_A}');`)).toContain("sector_members");
    expect(conversa(CONV_NONE).sector_id).toBeNull();
  });
});

describe("visibilidade por setor (papel agent)", () => {
  const ve = (user: string, conv: string) => countAs(user, `select count(*) from public.conversations where id = '${conv}';`);
  const veMensagens = (user: string, conv: string) => countAs(user, `select count(*) from public.messages where conversation_id = '${conv}';`);

  it("membro do setor vê; agent de fora não vê a conversa nem as mensagens dela", () => {
    expect(ve(GOV_AGENT_A, CONV_FIN)).toBe(1);
    expect(ve(GOV_AGENT_B, CONV_FIN)).toBe(0);
    expect(veMensagens(GOV_AGENT_A, CONV_FIN)).toBe(1);
    expect(veMensagens(GOV_AGENT_B, CONV_FIN)).toBe(0);
    expect(ve(GOV_AGENT_B, CONV_COM)).toBe(1);
    expect(ve(GOV_AGENT_A, CONV_COM)).toBe(0);
  });

  it("dono direto vê mesmo fora do setor; setor scope=all vê tudo; manager vê tudo", () => {
    expect(ve(GOV_AGENT_A, CONV_COM_TO_A)).toBe(1);
    expect(ve(AGENT_C, CONV_FIN)).toBe(1);
    expect(ve(AGENT_C, CONV_COM)).toBe(1);
    expect(ve(GOV_MANAGER, CONV_FIN)).toBe(1);
    expect(ve(GOV_MANAGER, CONV_COM)).toBe(1);
  });

  it("conversa sem setor segue visibility_mode (own_and_unassigned: fila visível a todo agent)", () => {
    expect(ve(GOV_AGENT_A, CONV_NONE)).toBe(1);
    expect(ve(GOV_AGENT_B, CONV_NONE)).toBe(1);
  });

  it("visibility_mode NÃO abre conversa de setor: com 'all' o agent de fora continua sem ver", () => {
    sql(`update public.organizations set settings = coalesce(settings, '{}'::jsonb) || '{"visibility_mode":"all"}'::jsonb where id = '${GOV_ORG}';`);
    try {
      expect(ve(GOV_AGENT_B, CONV_NONE)).toBe(1);
      expect(ve(GOV_AGENT_B, CONV_FIN)).toBe(0);
    } finally {
      sql(`update public.organizations set settings = settings - 'visibility_mode' where id = '${GOV_ORG}';`);
    }
  });

  it("setor inativo cai na regra antiga", () => {
    sql(`update public.sectors set is_active = false where id = '${FIN}';`);
    try {
      expect(ve(GOV_AGENT_B, CONV_FIN)).toBe(1);
    } finally {
      sql(`update public.sectors set is_active = true where id = '${FIN}';`);
    }
    expect(ve(GOV_AGENT_B, CONV_FIN)).toBe(0);
  });

  it("a org B não vê nada da org A e vice-versa", () => {
    expect(ve(AGENT_B2, CONV_FIN)).toBe(0);
    expect(ve(GOV_AGENT_A, CONV_B)).toBe(0);
    expect(ve(AGENT_B2, CONV_B)).toBe(1);
  });
});

describe("escrita: quem chama só mexe no que vê", () => {
  it("fn_conversation_assign recusa o agent de fora do setor e aceita o membro", () => {
    expect(falhaComo(GOV_AGENT_B, `select public.fn_conversation_assign('${GOV_ORG}', '${CONV_FIN}', '${GOV_AGENT_B}', 'claim');`)).toContain("conversation_not_visible");
    expect(conversa(CONV_FIN).assigned_to_user_id).toBeNull();
    asUser(GOV_AGENT_A, `select public.fn_conversation_assign('${GOV_ORG}', '${CONV_FIN}', '${GOV_AGENT_A}', 'claim');`);
    expect(conversa(CONV_FIN)).toMatchObject({ assigned_to_user_id: GOV_AGENT_A, status: "claimed", handover_from_user_id: null });
  });

  it("o roteamento não entrega conversa de setor a quem não é membro", () => {
    sql(`
      insert into public.attendant_availability (organization_id, user_id, is_available, capacity, schedule) values
        ('${GOV_ORG}', '${GOV_AGENT_A}', true, 50, '{}'),
        ('${GOV_ORG}', '${GOV_AGENT_B}', true, 50, '{}')
        on conflict (organization_id, user_id) do update set is_available = true, capacity = 50, schedule = '{}';
    `);
    const claim = (user: string) =>
      lastLine(sql(`select public.fn_channel_routing_claim('${GOV_ORG}', '${CONV_FIN_ROUTING}', '${GOV_SESSION}', '${user}', '{}');`));
    expect(claim(GOV_AGENT_B)).toBe("candidate_not_allowed");
    expect(conversa(CONV_FIN_ROUTING).assigned_to_user_id).toBeNull();
    expect(claim(GOV_AGENT_A)).toBe("assigned");
    expect(conversa(CONV_FIN_ROUTING).assigned_to_user_id).toBe(GOV_AGENT_A);
  });
});

describe("passagem de bastão", () => {
  const ve = (user: string, conv: string) => countAs(user, `select count(*) from public.conversations where id = '${conv}';`);

  it("quem transferiu continua vendo até o novo dono mandar a primeira mensagem", () => {
    // A é dona de CONV_COM_TO_A (setor COM, do qual A NÃO é membro). A transfere para B.
    asUser(GOV_AGENT_A, `select public.fn_conversation_assign('${GOV_ORG}', '${CONV_COM_TO_A}', '${GOV_AGENT_B}', 'transfer');`);
    expect(conversa(CONV_COM_TO_A)).toMatchObject({ assigned_to_user_id: GOV_AGENT_B, handover_from_user_id: GOV_AGENT_A });
    expect(ve(GOV_AGENT_A, CONV_COM_TO_A)).toBe(1);

    // Mensagem de quem está passando o bastão NÃO encerra a passagem.
    mensagem(CONV_COM_TO_A, CONTATO(4), GOV_AGENT_A);
    expect(conversa(CONV_COM_TO_A).handover_from_user_id).toBe(GOV_AGENT_A);
    // Mensagem da IA (sem autor humano) também não.
    mensagem(CONV_COM_TO_A, CONTATO(4), null);
    expect(conversa(CONV_COM_TO_A).handover_from_user_id).toBe(GOV_AGENT_A);

    // A primeira mensagem do NOVO dono encerra: A deixa de ver.
    mensagem(CONV_COM_TO_A, CONTATO(4), GOV_AGENT_B);
    expect(conversa(CONV_COM_TO_A).handover_from_user_id).toBeNull();
    expect(ve(GOV_AGENT_A, CONV_COM_TO_A)).toBe(0);
    expect(ve(GOV_AGENT_B, CONV_COM_TO_A)).toBe(1);
  });

  it("transferir para um setor: sem dono, pending, bastão com quem era dono, evento, roteamento reaberto, idempotente", () => {
    const antes = Number(lastLine(sql(`select count(*) from public.conversation_assignment_events where conversation_id = '${CONV_COM}' and reason = 'sector_transfer';`)));
    sql(`select public.fn_conversation_transfer_sector('${GOV_ORG}', '${CONV_COM}', '${FIN}', '${GOV_AGENT_B}');`);
    expect(conversa(CONV_COM)).toMatchObject({ sector_id: FIN, assigned_to_user_id: null, status: "pending", handover_from_user_id: GOV_AGENT_B });

    const evento = lastLine(sql(`
      select from_user_id::text || '|' || coalesce(to_user_id::text, '') || '|' || from_sector_id::text || '|' || to_sector_id::text
        from public.conversation_assignment_events
       where conversation_id = '${CONV_COM}' and reason = 'sector_transfer'
       order by created_at desc limit 1;`));
    expect(evento).toBe(`${GOV_AGENT_B}||${COM}|${FIN}`);
    expect(Number(lastLine(sql(`select count(*) from public.event_log where event_type = 'conversation.routing_requested' and entity_id = '${CONV_COM}' and status in ('pending','processing');`)))).toBe(1);

    // B (do COM) segue vendo pelo bastão; A (do FIN) passa a ver pelo setor.
    expect(ve(GOV_AGENT_B, CONV_COM)).toBe(1);
    expect(ve(GOV_AGENT_A, CONV_COM)).toBe(1);

    // Repetir a mesma transferência não gera segundo evento.
    sql(`select public.fn_conversation_transfer_sector('${GOV_ORG}', '${CONV_COM}', '${FIN}', '${GOV_AGENT_B}');`);
    const depois = Number(lastLine(sql(`select count(*) from public.conversation_assignment_events where conversation_id = '${CONV_COM}' and reason = 'sector_transfer';`)));
    expect(depois).toBe(antes + 1);
  });

  it("transferir para setor recusa: setor de outra org, ator que não vê a conversa, papel sem sessão e authenticated direto", () => {
    expect(falhaComoServico(`select public.fn_conversation_transfer_sector('${GOV_ORG}', '${CONV_FIN_FORBIDDEN}', '${FIN_B}', '${GOV_MANAGER}');`)).toContain("sector_not_found");
    expect(falhaComoServico(`select public.fn_conversation_transfer_sector('${GOV_ORG}', '${CONV_FIN_FORBIDDEN}', '${COM}', '${GOV_AGENT_B}');`)).toContain("sector_transfer_forbidden");
    expect(falhaComoServico(`select public.fn_conversation_transfer_sector('${GOV_ORG}', '${CONV_FIN_FORBIDDEN}', '${COM}', '${AGENT_B2}');`)).toContain("sector_transfer_forbidden");
    expect(falhaComo(GOV_MANAGER, `select public.fn_conversation_transfer_sector('${GOV_ORG}', '${CONV_FIN_FORBIDDEN}', '${COM}', '${GOV_MANAGER}');`)).toContain("permission denied");
    expect(conversa(CONV_FIN_FORBIDDEN)).toMatchObject({ sector_id: FIN, assigned_to_user_id: null });
  });
});
