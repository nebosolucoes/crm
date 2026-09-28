/**
 * Configurações → Setores de atendimento (spec 20 §4).
 *
 * A porta de quem decide "quem atende o quê": financeiro, comercial, suporte…
 * Cada setor tem os membros que atendem nele, uma descrição que a IA lê para
 * escolher o destino do handoff, e um escopo (vê só o próprio setor, ou tudo).
 *
 * Gate = manager+, e SEM o atalho de platform admin: a escrita passa pela RLS
 * `tenant_isolation_sectors_write` (manager+ da organização), e um botão que
 * aparece para quem a RLS recusa é um botão que responde 403.
 *
 * Não chama `exigirRecurso`: o grupo `organizacao` do catálogo não tem recurso
 * de plano (a API já gateia por `feature: "inbox"`), e a cerca
 * `paginas-exigem-recurso` reprova a chamada numa página sem recurso.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { entitlementsDaOrg } from "@/lib/entitlements/resolver";
import { tetoDe } from "@/lib/entitlements/limites";
import { traduzir } from "@/lib/i18n/dicionario";
import { loadEligibleAttendants } from "@/lib/routing/eligibles";
import { isServiceRoleConfigured } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";
import { SECTOR_COLUMNS_COM_MEMBROS, achatarMembros, type LinhaComMembros } from "@/lib/setores/colunas";
import type { SectorRow } from "@/hooks/setores/useSetores";

import { SetoresClient } from "./_setores-client";

export const dynamic = "force-dynamic";

export default async function SetoresSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const idioma = user.idioma;
  const orgId = activeOrg.orgId;

  const supabase = await createClient();
  const [setoresRes, membrosRes, entitlements] = await Promise.all([
    supabase
      .from("sectors")
      .select(SECTOR_COLUMNS_COM_MEMBROS)
      .eq("organization_id", orgId)
      .order("is_active", { ascending: false })
      .order("name"),
    supabase
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", orgId)
      .is("revoked_at", null)
      .in("role", ["agent", "manager", "admin"]),
    entitlementsDaOrg(orgId),
  ]);
  if (setoresRes.error) throw new Error(setoresRes.error.message);
  if (membrosRes.error) throw new Error(membrosRes.error.message);

  const ids = (membrosRes.data ?? []).map((m) => String(m.user_id));
  const nomes = await nomesDosAtendentes(ids);
  const membros = ids.map((id) => ({ id, name: nomes.get(id) ?? "Atendente sem nome" }));

  // Quem está disponível AGORA (disponível ∧ no horário ∧ com folga) — o mesmo
  // cálculo do roteamento. Serve ao aviso "setor sem ninguém disponível". Lido
  // com o admin client filtrado pela organização; sem service role, a tela
  // simplesmente não afirma nada sobre disponibilidade.
  let disponiveisAgora: string[] | null = null;
  if (isServiceRoleConfigured()) {
    try {
      const elegiveis = await loadEligibleAttendants(createAdminClient(), orgId, new Date(), {
        kind: "organization_summary",
      });
      disponiveisAgora = elegiveis.map((e) => e.userId);
    } catch {
      disponiveisAgora = null;
    }
  }

  const setores = (setoresRes.data ?? []).map((l) => achatarMembros(l as LinhaComMembros)) as unknown as SectorRow[];
  const teto = tetoDe(entitlements.limits, "max_sectors");

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Setores de atendimento", idioma)}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {traduzir(
            "Financeiro, comercial, suporte: cada setor tem quem atende nele e uma descrição que a IA lê para encaminhar a conversa ao lugar certo. Um atendente só vê as conversas dos seus setores; gestores e um setor de supervisão veem tudo.",
            idioma,
          )}
        </p>
      </header>
      <SetoresClient
        initial={{
          setores,
          membros,
          disponiveisAgora,
          teto: teto ?? null,
          souAdmin: ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin,
        }}
      />
    </div>
  );
}
