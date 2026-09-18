import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { AgendamentosClient } from "../agendamentos/_client";

type AbaDeDisparo = "agendamentos" | "agendar" | "grupos" | "historico";

export async function DisparoPage({ aba }: { aba: AbaDeDisparo }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar =
    (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  return <AgendamentosClient podeEditar={podeEditar} abaInicial={aba} />;
}
