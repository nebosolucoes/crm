import { describe, expect, it, vi } from "vitest";
import type pg from "pg";

import {
  carregarSetoresAtivos,
  renderBlocoDeSetores,
  resolverSetorDoHandoff,
} from "@/lib/agent-engine/agent/setores";
import { requestHumanHandoffInputSchema } from "@/lib/agent-engine/agent/human-handoff";

/**
 * O handoff com SETOR (spec 20 §3.2), na parte que não precisa de Postgres:
 *
 *   - o schema da ferramenta aceita `sector` como slug e recusa o resto;
 *   - a resolução do destino: slug do payload > setor de entrega do agente >
 *     nenhum; slug desconhecido volta a LISTA válida (erro de ensino);
 *   - o bloco do prompt só existe com setor ativo, e lista slug, nome e descrição.
 *
 * O efeito no banco (sector_id na conversa, membro do setor recebendo) é medido
 * em tests/invariants/setores-de-atendimento.test.ts.
 */

function pool(respostas: (sql: string, args: unknown[]) => unknown[]): pg.Pool {
  return { query: vi.fn(async (sql: string, args: unknown[]) => ({ rows: respostas(sql, args) })) } as unknown as pg.Pool;
}

const FIN = { id: "fin-id", slug: "financeiro", name: "Financeiro", description: "boletos e cobrança" };
const COM = { id: "com-id", slug: "comercial", name: "Comercial", description: "" };

describe("schema da ferramenta", () => {
  it("aceita reason e sector (slug), recusa campo extra e slug fora do padrão", () => {
    expect(requestHumanHandoffInputSchema.safeParse({ reason: "quer boleto", sector: "financeiro" }).success).toBe(true);
    expect(requestHumanHandoffInputSchema.safeParse({}).success).toBe(true);
    expect(requestHumanHandoffInputSchema.safeParse({ sector: "Financeiro" }).success).toBe(false);
    expect(requestHumanHandoffInputSchema.safeParse({ sector_id: "x" }).success).toBe(false);
  });
});

describe("resolverSetorDoHandoff", () => {
  it("slug válido vence o setor do agente", async () => {
    const db = pool((sql) => (sql.includes("slug = $2") ? [{ id: FIN.id }] : []));
    expect(await resolverSetorDoHandoff(db, "org", { slug: "financeiro", agentSectorId: COM.id })).toEqual({ ok: true, sectorId: FIN.id });
  });
  it("sem slug usa o setor de entrega do agente; sem os dois, null", async () => {
    const db = pool(() => []);
    expect(await resolverSetorDoHandoff(db, "org", { agentSectorId: COM.id })).toEqual({ ok: true, sectorId: COM.id });
    expect(await resolverSetorDoHandoff(db, "org", { agentSectorId: null })).toEqual({ ok: true, sectorId: null });
    expect(await resolverSetorDoHandoff(db, "org", {})).toEqual({ ok: true, sectorId: null });
  });
  it("slug desconhecido (ou inativo) devolve a lista válida para ensinar o modelo", async () => {
    const db = pool((sql) => (sql.includes("slug = $2") ? [] : [FIN, COM]));
    expect(await resolverSetorDoHandoff(db, "org", { slug: "juridico", agentSectorId: COM.id })).toEqual({
      ok: false, slugDesconhecido: "juridico", slugsValidos: ["financeiro", "comercial"],
    });
  });
  it("slug fora do padrão não vai ao banco como slug: volta a lista direto", async () => {
    const db = pool((sql) => (sql.includes("slug = $2") ? [{ id: "nunca" }] : [FIN]));
    const r = await resolverSetorDoHandoff(db, "org", { slug: "Fin anceiro" });
    expect(r).toEqual({ ok: false, slugDesconhecido: "Fin anceiro", slugsValidos: ["financeiro"] });
  });
  it("a consulta filtra a organização", async () => {
    const db = pool(() => [{ id: FIN.id }]);
    await resolverSetorDoHandoff(db, "org-1", { slug: "financeiro" });
    expect(vi.mocked(db.query)).toHaveBeenCalledWith(expect.stringContaining("organization_id = $1"), ["org-1", "financeiro"]);
  });
});

describe("bloco do prompt", () => {
  it("sem setor ativo não há bloco", async () => {
    expect(renderBlocoDeSetores([])).toBeNull();
    const db = pool(() => []);
    expect(await carregarSetoresAtivos(db, "org")).toEqual([]);
  });
  it("lista slug, nome e descrição (quando há), e ensina a omitir", () => {
    const bloco = renderBlocoDeSetores([FIN, COM])!;
    expect(bloco).toContain("- financeiro — Financeiro: boletos e cobrança");
    expect(bloco).toContain("- comercial — Comercial");
    expect(bloco).not.toContain("Comercial:");
    expect(bloco).toContain("não envie `sector`");
  });
});
