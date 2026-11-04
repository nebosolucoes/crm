/**
 * PARA QUEM UM ATENDENTE PODE TRANSFERIR (spec 20 §3.4) — num lugar só.
 *
 * O servidor da transferência (`conversations/[id]/transfer`) recusa, para quem
 * é `agent`, o destino que não divide nenhum setor ATIVO com ele. A lista da
 * janela de transferência (`team/assignable`) oferecia a organização inteira, e
 * a pessoa só descobria a regra depois de escolher: 3 recusas 422 em produção em
 * 03/11/2026, a mesma atendente tentando de novo. Com a regra aqui, a lista
 * marca quem pode receber e a recusa continua no servidor — pela MESMA função.
 *
 * Atendente sem setor nenhum (organização sem setores, ou ele fora de todos) não
 * é restringido: é o comportamento de antes da spec 20.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

type ClienteAdmin = ReturnType<typeof createAdminClient>;

/** `true` = quem transfere está em algum setor e o destino não divide nenhum com ele. Pura. */
export function foraDosMeusSetores(
  meus: ReadonlySet<string>,
  doDestino: ReadonlySet<string> | undefined,
): boolean {
  if (meus.size === 0) return false;
  if (!doDestino) return true;
  for (const s of meus) if (doDestino.has(s)) return false;
  return true;
}

/**
 * Os setores ATIVOS de cada pessoa pedida, numa consulta. Cliente de serviço:
 * a RLS de `sector_members` não mostra os setores dos colegas a um agent — por
 * isso o filtro de `organization_id` (de fonte confiável) é obrigatório aqui.
 */
export async function setoresAtivosPorPessoa(
  admin: ClienteAdmin,
  orgId: string,
  userIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const porPessoa = new Map<string, Set<string>>();
  if (userIds.length === 0) return porPessoa;
  const { data, error } = await admin
    .from("sector_members")
    .select("sector_id, user_id, sectors!inner(is_active)")
    .eq("organization_id", orgId)
    .in("user_id", [...userIds])
    .eq("sectors.is_active", true);
  if (error) throw new Error(error.message);
  for (const m of (data ?? []) as Array<{ sector_id: string; user_id: string }>) {
    const setores = porPessoa.get(m.user_id) ?? new Set<string>();
    setores.add(m.sector_id);
    porPessoa.set(m.user_id, setores);
  }
  return porPessoa;
}

/** A recusa do servidor da transferência. */
export async function recusaForaDosMeusSetores(
  admin: ClienteAdmin,
  orgId: string,
  actorId: string,
  toUserId: string,
): Promise<boolean> {
  const porPessoa = await setoresAtivosPorPessoa(admin, orgId, [actorId, toUserId]);
  return foraDosMeusSetores(porPessoa.get(actorId) ?? new Set(), porPessoa.get(toUserId));
}
