/**
 * Vocabulário dos SETORES de atendimento (spec 20) — a ÚNICA lista.
 *
 * O CHECK `sectors_scope_check` do banco espelha `SECTOR_SCOPES`; a paridade é
 * cobrada por `tests/invariants/vocabulario-banco-x-typescript.test.ts`. Valor
 * novo entra aqui E na migration que reconstrói o CHECK, no mesmo commit.
 *
 * Client-safe: sem zod, supabase ou `lib/env` — a tela de Setores importa daqui.
 */

/**
 * `own`  — o membro vê só as conversas do próprio setor.
 * `all`  — o setor que vê tudo (supervisão): membro vê toda conversa da organização.
 */
export const SECTOR_SCOPES = ["own", "all"] as const;
export type SectorScope = (typeof SECTOR_SCOPES)[number];

export const ROTULO_DO_ESCOPO: Record<SectorScope, string> = {
  own: "Vê só o próprio setor",
  all: "Vê todos os setores",
};

export function ehEscopoDeSetor(valor: unknown): valor is SectorScope {
  return typeof valor === "string" && (SECTOR_SCOPES as readonly string[]).includes(valor);
}

/** Mesma régua do CHECK `sectors_slug_check`: o que o agente de IA manda no payload da ferramenta. */
export const SECTOR_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Nome → slug, do jeito que a tela sugere ("Financeiro & Cobrança" → "financeiro-cobranca"). */
export function slugDoSetor(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
