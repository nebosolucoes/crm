import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FONTE = readFileSync(join(process.cwd(), "lib", "agendamentos-grupos", "worker.ts"), "utf8");
const FONTE_EXECUCOES = readFileSync(
  join(process.cwd(), "app", "api", "v1", "agendamentos", "execucoes", "route.ts"),
  "utf8",
);

describe("worker de disparos em grupo", () => {
  it("desambigua as relações compostas por organização no PostgREST", () => {
    expect(FONTE).toContain("scheduled_whatsapp_groups!scheduled_group_messages_group_id_fkey");
    expect(FONTE).toContain("channel_sessions!scheduled_group_messages_channel_org_fkey");
  });

  it("usa a FK composta real ao listar o histórico de execuções", () => {
    expect(FONTE_EXECUCOES).toContain(
      "scheduled_group_messages!scheduled_group_message_runs_message_org_fkey",
    );
    expect(FONTE_EXECUCOES).not.toContain(
      "scheduled_group_messages!scheduled_group_message_runs_scheduled_message_id_fkey",
    );
  });

  it("não reutiliza o mesmo slot quando há colisão de claim", () => {
    expect(FONTE).toContain("const attempt = (latestRun?.attempt ?? 0) + 1;");
    expect(FONTE).toContain('error_code: "worker_timeout"');
    expect(FONTE).toContain('latestRun?.status === "failed"');
  });

  it("registra que o horário chegou antes de chamar o canal", () => {
    const criaPendente = FONTE.indexOf('status: "pending"');
    const iniciaEnvio = FONTE.indexOf('.update({ status: "sending"');
    const chamaCanal = FONTE.indexOf("await adapter.send");

    expect(criaPendente).toBeGreaterThan(-1);
    expect(iniciaEnvio).toBeGreaterThan(criaPendente);
    expect(chamaCanal).toBeGreaterThan(iniciaEnvio);
    expect(FONTE).toContain('.in("status", ["pending", "sending"])');
  });

  it("fecha a ocorrência também quando o envio falha ou é ignorado", () => {
    expect(FONTE).toContain("await avancarAgendamentoDepoisDaTentativa(");
    expect(FONTE).toContain("const falhar = async");
    expect(FONTE).toMatch(
      /const falhar = async[\s\S]*?await avancarAgendamentoDepoisDaTentativa\(/,
    );
    expect(FONTE).toContain('.eq("next_run_at", scheduledFor)');
  });

  it("assina a mídia privada somente no momento do disparo", () => {
    expect(FONTE).toContain('from("whatsapp-media")');
    expect(FONTE).toContain("createSignedUrl(media.storage_path, 600)");
    expect(FONTE).toContain('kind: media?.kind ?? "text"');
  });
});
