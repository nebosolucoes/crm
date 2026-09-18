import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { loadOnboardingState } from "@/app/actions/onboarding/_shared";
import { resumoDoOnboarding } from "@/lib/onboarding/passos";
import { oQueMaisExiste } from "@/lib/onboarding/o-que-mais-existe";
import { DoneClient } from "./_client";
import { contextoDoOnboarding } from "@/lib/onboarding/contexto";

export const dynamic = "force-dynamic";

export default async function DonePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");

  const { state } = await loadOnboardingState(activeOrg.orgId);

  // O resumo sai da MESMA fonte que decidiu a ordem e desenhou o indicador.
  // Antes era uma terceira lista, fixa, e por isso ela listava "Loja Nuvemshop
  // (pulado)" em instalações que nunca ofereceram esse passo — o wizard
  // acusando a pessoa de não fazer o que ninguém lhe pediu.
  const itens = resumoDoOnboarding(state, await contextoDoOnboarding(activeOrg.orgId));

  return <DoneClient itens={itens} pecas={oQueMaisExiste()} />;
}
