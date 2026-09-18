import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * A TELA DE DISPARO REAGE AO ENVIO — E SÓ AS TABELAS QUE MUDAM DE ESTADO PUBLICAM.
 *
 * Sem `scheduled_group_message_runs` e `scheduled_group_messages` na publicação
 * `supabase_realtime`, o canal da lista sobe, o `subscribe` devolve SUBSCRIBED e
 * nenhum evento chega: a pessoa fica olhando "Agendado" depois do horário até
 * apertar Atualizar. Medido ao vivo antes da 0266 (envio às 14:45:06, tela
 * parada); depois dela, "Enviado" apareceu 1,2 s após o `sent_at`, sem reload.
 *
 * A terceira asserção é tão necessária quanto as duas primeiras:
 * `scheduled_whatsapp_groups` é catálogo reescrito em lote pelo "Listar grupos
 * da conexão" — publicá-la faria um sync de 50 grupos virar 50 pulsos.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db`");
const containerName: string = container;

function publicadas(): string[] {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-tA",
      "-c",
      "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by 1",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("o disparo programado na publicação de realtime (migration 0266)", () => {
  it("a sonda enxerga a publicação (guarda de vacuidade)", () => {
    expect(publicadas().length).toBeGreaterThan(5);
  });

  it("scheduled_group_message_runs PUBLICA — é a execução que a lista espera ver mudar", () => {
    expect(publicadas()).toContain("scheduled_group_message_runs");
  });

  it("scheduled_group_messages PUBLICA — o pai avança (completed / próximo horário) depois da tentativa", () => {
    expect(publicadas()).toContain("scheduled_group_messages");
  });

  it("scheduled_whatsapp_groups NÃO publica — catálogo reescrito em lote não é mudança de estado", () => {
    expect(publicadas()).not.toContain("scheduled_whatsapp_groups");
  });
});
