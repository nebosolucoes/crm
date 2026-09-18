import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte } from "@/lib/branding/saida";
import { DESCRICAO_DO_RECURSO, ROTULO_DO_RECURSO, ehRecurso } from "@/lib/entitlements/recursos";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recurso não incluído no plano" };

/**
 * Onde `exigirRecurso()` deixa quem abre uma tela que o plano da organização
 * não inclui — pela URL digitada, por um link salvo, ou por um atalho antigo.
 *
 * Fica DENTRO do shell de `/app` (Sidebar visível) de propósito: a pessoa não
 * errou nada e não perdeu a sessão — só chegou a uma porta que a organização
 * dela não tem. Um 403 de tela cheia, como o de papel, diria "você não pode";
 * aqui a mensagem é "sua empresa não tem isto", que pede outra ação de quem lê:
 * o admin fala com quem vende o plano, o atendente fala com o admin.
 *
 * Não tem porta na navegação (chega-se por redirect), e por isso está na
 * allowlist de `tests/unit/navegacao-completude.test.ts` com o motivo.
 */
export default async function RecursoIndisponivelPage({
  searchParams,
}: {
  searchParams: Promise<{ recurso?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);
  const { recurso } = await searchParams;
  const conhecido = ehRecurso(recurso) ? recurso : null;
  const ehAdmin = !!activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;
  const suporte = emailDeSuporte();

  return (
    <main className="flex h-full items-center justify-center p-8">
      <Card className="w-full max-w-lg p-8 text-center" data-testid="recurso-indisponivel">
        <h1 className="text-2xl font-semibold">
          {conhecido
            ? `${t(ROTULO_DO_RECURSO[conhecido])} ${t("não está incluído no seu plano")}`
            : t("Este recurso não está incluído no seu plano")}
        </h1>
        {conhecido && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t(DESCRICAO_DO_RECURSO[conhecido])}
          </p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          {ehAdmin
            ? suporte
              ? (
                <>
                  {t("Para incluir este recurso, fale com quem opera este sistema:")}{" "}
                  <a className="underline" href={`mailto:${suporte}`}>
                    {suporte}
                  </a>
                  .
                </>
              )
              : t("Para incluir este recurso, fale com quem opera este sistema.")
            : t("Peça a quem administra a sua organização para conferir o plano.")}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/app">{t("Voltar")}</Link>
          </Button>
          {ehAdmin && (
            <Button asChild>
              <Link href="/app/settings/billing">{t("Ver plano e recursos")}</Link>
            </Button>
          )}
        </div>
      </Card>
    </main>
  );
}
