import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FONTE = readFileSync(
  join(process.cwd(), "lib", "agendamentos-grupos", "worker.ts"),
  "utf8",
);
const FONTE_EXECUCOES = readFileSync(
  join(process.cwd(), "app", "api", "v1", "agendamentos", "execucoes", "route.ts"),
  "utf8",
);

describe("worker de disparos em grupo", () => {
  it("desambigua as relações compostas por organização no PostgREST", () => {
    expect(FONTE).toContain(
      "scheduled_whatsapp_groups!scheduled_group_messages_group_id_fkey",
    );
    expect(FONTE).toContain(
      "channel_sessions!scheduled_group_messages_channel_org_fkey",
    );
  });

  it("usa a FK composta real ao listar o histórico de execuções", () => {
    expect(FONTE_EXECUCOES).toContain(
      "scheduled_group_messages!scheduled_group_message_runs_message_org_fkey",
    );
    expect(FONTE_EXECUCOES).not.toContain(
      "scheduled_group_messages!scheduled_group_message_runs_scheduled_message_id_fkey",
    );
  });

  it("permite nova tentativa sem reutilizar o mesmo slot", () => {
    expect(FONTE).toContain("const attempt = (latestRun?.attempt ?? 0) + 1;");
    expect(FONTE).toContain('error_code: "worker_timeout"');
  });
});
