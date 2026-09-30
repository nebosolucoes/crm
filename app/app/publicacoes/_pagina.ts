import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { fusoDaOrganizacao } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * O que toda página de Publicações precisa: quem pode editar (manager+) e o
 * FUSO da organização — a tela converte toda hora de parede nele, nunca no
 * fuso do navegador. `exigirRecurso("broadcast")` fica em cada `page.tsx`,
 * como primeiro `await`, porque a cerca de plano lê o literal lá.
 */
export async function contextoDePublicacoes(): Promise<{ podeEditar: boolean; fuso: string }> {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const podeEditar = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const fuso = await fusoDaOrganizacao(createAdminClient(), activeOrg.orgId);
  return { podeEditar, fuso };
}
