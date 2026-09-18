import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Disparo usa portas reais de navegação", () => {
  it("não renderiza seletor de submenus no meio da página", () => {
    const fonte = readFileSync("app/app/agendamentos/_client.tsx", "utf8");
    expect(fonte).not.toContain("TabsTrigger");
    expect(fonte).toContain("/api/v1/agendamentos/grupos/sync");
    expect(fonte).toContain("Listar grupos da conexão");
    expect(fonte).toContain("Pesquisar grupo pelo nome");
    expect(fonte).toContain("Grupo de avisos");
    expect(fonte).toContain("participantCount");
    expect(fonte).toContain("Editar");
    expect(fonte).toContain("Salvar alterações");
    expect(fonte).toContain("apiClient.patch(`/api/v1/agendamentos/${editandoId}`");
    expect(fonte).toContain("Adicionar foto ou vídeo");
    expect(fonte).toContain("/api/v1/agendamentos/media");
    expect(fonte).toContain("Última execução:");
    expect(fonte).toContain("flex h-full min-h-0 w-full");
    expect(fonte).not.toContain("max-w-6xl");
    // A lista reage ao banco (migration 0266): as duas tabelas que mudam de estado,
    // filtradas pela organização, e a recarga silenciosa que elas disparam.
    expect(fonte).toContain('table: "scheduled_group_message_runs"');
    expect(fonte).toContain('table: "scheduled_group_messages"');
    expect(fonte).toContain("filter: `organization_id=eq.${orgId}`");
    expect(fonte).toContain("carregar({ silencioso: true })");
  });
});
