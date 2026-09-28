/**
 * Colunas e projeção das rotas de setores (`/api/v1/sectors`). Vive fora do
 * `route.ts` porque um arquivo de rota só pode exportar handlers e config.
 */
export const SECTOR_COLUMNS =
  "id, organization_id, name, slug, description, scope, is_active, created_at, updated_at";
export const SECTOR_COLUMNS_COM_MEMBROS = `${SECTOR_COLUMNS}, sector_members(user_id)`;

export interface LinhaComMembros {
  sector_members?: Array<{ user_id: string }> | null;
  [k: string]: unknown;
}

/** `sector_members(user_id)` vira `members: string[]` — a tela não precisa do embed cru. */
export function achatarMembros(linha: LinhaComMembros): Record<string, unknown> {
  const { sector_members, ...resto } = linha;
  return { ...resto, members: (sector_members ?? []).map((m) => m.user_id) };
}
