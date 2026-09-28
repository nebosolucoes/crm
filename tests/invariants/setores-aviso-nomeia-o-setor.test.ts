import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * O AVISO DE CONVERSA SEM DONO NOMEIA O SETOR (migration 0279, spec 20 fase 5).
 *
 * `fn_routing_unassigned_notice` é chamada pelo worker quando o roteamento não
 * acha ninguém. Com a conversa num setor, o título tem de dizer QUAL setor está
 * parado e o corpo apontar para a tela dos setores; sem setor, o texto de
 * sempre. E o upsert precisa atualizar o TÍTULO: a conversa pode ter mudado de
 * setor entre um aviso e outro.
 */
const FIN = "ffffffff-3333-4000-8000-000000000001";
const CONTATO = (n: number) => `ffffffff-4444-4000-8000-00000000000${n}`;
const CONV_COM_SETOR = "ffffffff-5555-4000-8000-000000000001";
const CONV_SEM_SETOR = "ffffffff-5555-4000-8000-000000000002";

function aviso(conv: string): { title: string; body: string; status: string } {
  const out = sql(`select title || '|' || body || '|' || status from public.agent_inbox_items
                    where organization_id = '${GOV_ORG}' and kind = 'routing_unassigned' and ref_id = '${conv}';`);
  const [title, body, status] = lastLine(out).split("|");
  return { title: title ?? "", body: body ?? "", status: status ?? "" };
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.sectors (id, organization_id, name, slug) values ('${FIN}', '${GOV_ORG}', 'Financeiro', 'financeiro-aviso')
      on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO(1)}', '${GOV_ORG}', 'Aviso Contato 1'), ('${CONTATO(2)}', '${GOV_ORG}', 'Aviso Contato 2')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, sector_id) values
      ('${CONV_COM_SETOR}', '${GOV_ORG}', '${CONTATO(1)}', '${GOV_SESSION}', 'open', '${FIN}'),
      ('${CONV_SEM_SETOR}', '${GOV_ORG}', '${CONTATO(2)}', '${GOV_SESSION}', 'open', null)
      on conflict do nothing;
  `);
});

describe("fn_routing_unassigned_notice", () => {
  it("com setor: o título nomeia o setor e o corpo aponta para Configurações → Setores", () => {
    sql(`select public.fn_routing_unassigned_notice('${GOV_ORG}', '${CONV_COM_SETOR}', 'no_eligible');`);
    const a = aviso(CONV_COM_SETOR);
    expect(a.title).toBe("Uma conversa do setor Financeiro aguarda um responsável");
    expect(a.body).toContain("Setores de atendimento");
    expect(a.status).toBe("open");
  });

  it("sem setor: o texto de sempre", () => {
    sql(`select public.fn_routing_unassigned_notice('${GOV_ORG}', '${CONV_SEM_SETOR}', 'no_eligible');`);
    const a = aviso(CONV_SEM_SETOR);
    expect(a.title).toBe("Uma conversa aguarda um responsável");
    expect(a.body).toContain("Configurações → Atendimento");
  });

  it("setor inativo é tratado como sem setor, e o upsert atualiza o título", () => {
    sql(`update public.sectors set is_active = false where id = '${FIN}';`);
    try {
      sql(`select public.fn_routing_unassigned_notice('${GOV_ORG}', '${CONV_COM_SETOR}', 'no_eligible');`);
      expect(aviso(CONV_COM_SETOR).title).toBe("Uma conversa aguarda um responsável");
    } finally {
      sql(`update public.sectors set is_active = true where id = '${FIN}';`);
    }
    sql(`select public.fn_routing_unassigned_notice('${GOV_ORG}', '${CONV_COM_SETOR}', 'no_eligible');`);
    expect(aviso(CONV_COM_SETOR).title).toBe("Uma conversa do setor Financeiro aguarda um responsável");
    expect(Number(lastLine(sql(`select count(*) from public.agent_inbox_items where organization_id = '${GOV_ORG}' and kind = 'routing_unassigned' and ref_id = '${CONV_COM_SETOR}';`)))).toBe(1);
  });

  it("canal inválido continua com o texto do canal, mesmo com setor", () => {
    sql(`select public.fn_routing_unassigned_notice('${GOV_ORG}', '${CONV_COM_SETOR}', 'invalid_channel');`);
    expect(aviso(CONV_COM_SETOR).body).toContain("Conexões");
  });
});
