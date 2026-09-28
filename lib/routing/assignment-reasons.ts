/**
 * Motivos de um evento em `conversation_assignment_events` — a ÚNICA lista.
 *
 * O CHECK `conversation_assignment_events_reason_check` espelha esta tupla; a
 * paridade é cobrada por `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 * Antes da migration 0278 o vocabulário vivia só no CHECK, e cada emissor
 * escrevia a string à mão.
 *
 *   claim            alguém pegou a conversa da fila
 *   transfer         pessoa → pessoa (imediata, sem aceite — spec 13 §5)
 *   release          o dono devolveu à fila
 *   routing          o roteamento (rodízio) atribuiu
 *   handoff          a IA passou a um humano
 *   sector_transfer  pessoa → SETOR: sem dono, roteamento reaberto dentro do
 *                    setor novo, bastão com quem transferiu (spec 20 §2.2)
 *
 * Client-safe: sem dependências.
 */
export const ASSIGNMENT_REASONS = [
  "claim",
  "transfer",
  "release",
  "routing",
  "handoff",
  "sector_transfer",
] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

export function ehMotivoDeAtribuicao(valor: unknown): valor is AssignmentReason {
  return typeof valor === "string" && (ASSIGNMENT_REASONS as readonly string[]).includes(valor);
}
