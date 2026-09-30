/**
 * Publicações (migration 0283) no realtime — o que a tela assiste PUBLICA.
 *
 * A Lista, o Calendário e o Histórico assinam `publication_occurrences` e
 * `publication_executions` por `postgres_changes`. Tabela fora da publicação
 * não entrega evento nenhum e a tela só muda no refetch de segurança — foi o
 * defeito que a 0266 consertou no Disparo, e este teste é o mesmo guarda para
 * o modelo novo. Conteúdo, mídia e destinos ficam FORA de propósito: mudam só
 * quando alguém edita, e quem edita está na tela.
 */
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db`");
const containerName: string = container;

function publicadas(): string[] {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c",
      "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by 1"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("Publicações na publicação de realtime (migration 0283)", () => {
  it("publication_occurrences PUBLICA — é o que a Lista e o Calendário esperam ver mudar", () => {
    expect(publicadas()).toContain("publication_occurrences");
  });
  it("publication_executions PUBLICA — é o desfecho por destino que o Histórico acompanha", () => {
    expect(publicadas()).toContain("publication_executions");
  });
  it("conteúdo, mídia e destinos NÃO publicam — mudam só pela mão de quem está na tela", () => {
    const p = publicadas();
    expect(p).not.toContain("publications");
    expect(p).not.toContain("publication_media");
    expect(p).not.toContain("publication_targets");
    expect(p).not.toContain("publication_target_groups");
  });
});
