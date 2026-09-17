import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { entitlementsDaOrg } from "@/lib/entitlements/resolver";
import { serializarEntitlements } from "@/lib/entitlements/tipos";
import { homeDaInterface } from "@/lib/navigation/interface";
export default async function AppHome() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  // A home não pode ser um destino que o plano não tem: quem entra numa
  // organização sem Atendimento cai no primeiro destino que ELA tem, não em
  // /app/inbox para ser redirecionado de novo. Mesma memória por request do
  // layout — nenhuma consulta a mais.
  const entitlements = org ? serializarEntitlements(await entitlementsDaOrg(org.orgId)) : null;
  redirect(
    homeDaInterface(
      org?.interface_settings,
      user.is_platform_admin && !user.support,
      org?.role ?? null,
      entitlements,
    ),
  );
}
