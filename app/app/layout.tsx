import { InterfaceRefresh } from "@/hooks/auth/InterfaceRefresh";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isMfaEnrolled, loadAuthUser, requiresMfa, resolveActiveOrg } from "@/lib/auth/server";
import { DEFAULT_VISIBILITY_MODE, type VisibilityMode } from "@/lib/auth/types";
import { clientePelaAgendaLigado } from "@/lib/schemas/settings";
import { entitlementsDaOrg } from "@/lib/entitlements/resolver";
import { serializarEntitlements } from "@/lib/entitlements/tipos";
import { AuthProvider } from "@/hooks/auth/AuthProvider";
import { AppShell } from "./_components/AppShell";
import { MfaEnrollGate } from "@/components/auth/MfaEnrollGate";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ImpersonateBanner,
} from "@/components/app/ImpersonateBanner";
import { ConexaoCaidaBanner } from "@/components/app/ConexaoCaidaBanner";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { listarConexoesCaidas, type ConexaoCaida } from "@/lib/channels/health";
import { VoiceCallProvider } from "@/components/voice/VoiceCallContext";
import { acessoFoiRevogado } from "@/lib/auth/vinculo-revogado";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await loadAuthUser();
  if (!user) redirect("/login");

  let activeOrg = await resolveActiveOrg(user);

  // Sem organização ativa existem DOIS estados, e eles pedem telas opostas:
  //
  //  - nunca teve  → provisionamento que falhou no signup. `/get-started`
  //                  existe exatamente para isso e continua sendo o caminho.
  //  - teve e foi revogada → precisa SABER disso. Até 2026-09-10 essa pessoa
  //                  caía aqui mesmo, via a casca vazia e a oferta "Configure
  //                  sua organização" — uma revogação virando criação de
  //                  tenant. Medido numa instalação real.
  //
  // A consulta só roda neste ramo, que é o raro: quem tem organização não paga
  // nada por ela.
  if (!activeOrg && !user.support && (await acessoFoiRevogado(user.id))) {
    redirect("/acesso-revogado");
  }

  // EPIC-02: gate /app/* on completed onboarding.
  // EPIC-11: gate /app/* on org not being suspended (S-11.08).
  let conexoesCaidas: ConexaoCaida[] = [];
  let enrolled = false;
  let needsMfaGate = false;

  if (activeOrg) {
    const admin = createAdminClient();
    /**
     * As quatro consultas que TODA página de `/app` paga, disparadas juntas.
     *
     * Elas eram sequenciais e independentes: cada uma esperava a anterior sem
     * precisar do resultado dela, e a soma aparecia como a tela que não reage ao
     * clique. Em paralelo, o custo passa a ser o da mais lenta.
     *
     * Duas consequências que valem estar escritas, porque não são acidente:
     *
     *  - `listarConexoesCaidas` e `requiresMfa` agora rodam ANTES dos `redirect`
     *    de onboarding e de suspensão. Quem vai ser redirecionado paga duas
     *    consultas a mais — um caminho raro, que termina numa navegação de
     *    qualquer forma. O caminho normal, que é todo render de todo usuário,
     *    deixa de pagar três esperas em fila.
     *  - A consulta das conexões continua morando no seam
     *    (`lib/channels/health`), não aqui: tela que monta o select de
     *    `channel_sessions` à mão foi o que deixou três seletores oferecendo
     *    canal arquivado (invariante `canais-selecionaveis`), e de quebra o
     *    filtro de estados fica LITERALMENTE o mesmo que decide o aviso da
     *    Central. Vigiado por
     *    `tests/unit/faixa-de-conexao-caida-vem-do-seam.test.tsx`, que EXECUTA
     *    este layout — a cerca anterior lia o texto-fonte e reprovava esta
     *    refatoração sem que nada tivesse quebrado.
     */
    // A quinta consulta entra no MESMO `Promise.all`, pelo mesmo motivo das
    // outras quatro: independente, e paga por toda página. Erro dela LANÇA
    // (ver `lib/entitlements/resolver.ts`) — uma falha de banco não pode chegar
    // ao cliente como "seu plano perdeu o CRM".
    const [orgRes, conexoes, isEnrolled, mfaRequired, entitlements] = await Promise.all([
      admin
        .from("organizations")
        .select("onboarded_at, status, settings")
        .eq("id", activeOrg.orgId)
        .maybeSingle(),
      listarConexoesCaidas(admin, activeOrg.orgId),
      isMfaEnrolled(),
      requiresMfa(
        activeOrg.role,
        user.is_platform_admin,
        user.id,
        activeOrg.orgId,
      ),
      entitlementsDaOrg(activeOrg.orgId),
    ]);

    const orgRow = orgRes.data;
    conexoesCaidas = conexoes;
    enrolled = isEnrolled;
    needsMfaGate = mfaRequired;

    if (orgRow && !orgRow.onboarded_at && !user.support) redirect("/onboarding");
    if (orgRow?.status === "suspended") redirect("/account-suspended");
    // G4-02: expõe visibility_mode ao client (inbox decide visões visíveis).
    // Fonte confiável (admin client, org do cookie validado) — nunca do body.
    const mode = (orgRow?.settings as { visibility_mode?: VisibilityMode } | null)
      ?.visibility_mode;
    activeOrg = {
      ...activeOrg,
      visibility_mode: mode ?? DEFAULT_VISIBILITY_MODE,
      // Mesma linha de `settings` já lida acima — nenhuma consulta a mais.
      cliente_pela_agenda: clientePelaAgendaLigado(orgRow?.settings),
      // O que a organização pode usar, para o Sidebar/hubs/⌘K não desenharem o
      // que a API recusa. Não é autorização — ver `ActiveOrg.entitlements`.
      entitlements: serializarEntitlements(entitlements),
    };

    // Marca visual é global da instalação. `organizations.settings.branding`
    // permanece no jsonb por compatibilidade com clones antigos, mas o app do
    // tenant ignora esse envelope: nada de CSS escopado por organização e nada
    // de preencher `activeOrg.marca`.
  } else {
    const [isEnrolled, mfaRequired] = await Promise.all([
      isMfaEnrolled(),
      requiresMfa(undefined, user.is_platform_admin, user.id, undefined),
    ]);
    enrolled = isEnrolled;
    needsMfaGate = mfaRequired;
  }

  // Read sidebar collapsed state SSR to avoid flash.
  const store = await cookies();
  const collapsed = store.get("sidebar_collapsed")?.value === "1";

  const impersonating = user.support ? {
    tenantId: user.support.organization_id, tenantName: user.support.name,
    expiresAt: user.support.expires_at, accessMode: user.support.access_mode,
  } : null;

  const shell = (
    <VoiceCallProvider>
      <AppShell sidebarCollapsed={collapsed}>{children}</AppShell>
    </VoiceCallProvider>
  );

  return (
    // O idioma envolve a árvore inteira e recebe o código PRONTO — ele não
    // pergunta quem está logado. Ver `lib/i18n/IdiomaProvider`: foi o
    // acoplamento com a autenticação que derrubou 32 casos.
    <IdiomaProvider locale={user.idioma}>
    <AuthProvider user={user} activeOrg={activeOrg}>
      <InterfaceRefresh userId={user.id} org={activeOrg} support={!!user.support} />
      <div className="contents">
        <ImpersonateBanner impersonating={impersonating} />
        <ConexaoCaidaBanner caidas={conexoesCaidas} />
        {needsMfaGate ? (
          // Gate always mounted for MFA-required roles; it latches the blocking
          // decision client-side so the enroll Server Action's revalidation
          // can't tear down the recovery-codes screen mid-flow.
          <MfaEnrollGate enrolled={enrolled}>{shell}</MfaEnrollGate>
        ) : (
          shell
        )}
      </div>
    </AuthProvider>
    </IdiomaProvider>
  );
}
