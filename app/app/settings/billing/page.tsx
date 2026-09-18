import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte } from "@/lib/branding/saida";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { consumoDaOrg } from "@/lib/entitlements/consumo";
import { LIMITES } from "@/lib/entitlements/limites";
import { entitlementsDaOrg } from "@/lib/entitlements/resolver";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DESCRICAO_DO_RECURSO,
  RECURSOS,
  ROTULO_DO_RECURSO,
  sempreLigado,
} from "@/lib/entitlements/recursos";
import { overridesDoRecurso, temRecurso, type OverrideAtivo } from "@/lib/entitlements/tipos";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export const dynamic = "force-dynamic";

/**
 * A tela do PLANO — o que esta organização pode usar, e por quê.
 *
 * Era um placeholder ("Billing entra na Fase 2"). Desde a 0275 ela responde a
 * pergunta que a Central faz a pessoa vir aqui responder: qual é o plano, quais
 * recursos estão ligados, e — quando um recurso vem de uma liberação especial —
 * até quando. Cobrança (fatura, cartão) continua fora: quem cobra é quem opera
 * a instalação, e o contato dele é o único endereço desta tela.
 *
 * Lê pela MESMA memória por request do layout (`entitlementsDaOrg`): nenhuma
 * consulta a mais. A tela não decide nada — quem decide é o banco.
 */
export default async function BillingPage() {
  // spec 13 §4: billing é admin-only (viewer/agent/manager = none).
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const suporte = emailDeSuporte();
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);
  const e = await entitlementsDaOrg(activeOrg.orgId);
  // Só as chaves com teto: uma lista de "sem limite" não diz nada a ninguém.
  const consumo = (await consumoDaOrg(createAdminClient(), activeOrg.orgId, e.limits)).filter((m) => m.teto !== undefined);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          {t("Seu plano, os recursos liberados e até quando valem.")}
        </p>
      </header>

      <Card className="max-w-2xl p-6" data-testid="plano-atual">
        <h2 className="text-sm font-semibold">{t("Plano atual")}</h2>
        {e.origem === "sem_schema" && (
          <p className="mt-2 text-sm text-error-fg" data-testid="sem-schema">
            {t("O banco ainda não recebeu a atualização de planos. Tudo segue liberado como antes; avise quem administra o sistema.")}
          </p>
        )}
        {e.plan ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold" data-testid="plano-nome">
              {e.plan.name}
            </span>
            {e.origem === "padrao" && (
              <Badge variant="secondary">{t("padrão da instalação")}</Badge>
            )}
            {!e.plan.is_active && (
              <Badge variant="outline">{t("plano fora de circulação — você continua nele")}</Badge>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-error-fg" data-testid="plano-nome">
            {t("Nenhum plano atribuído. Fale com quem administra este sistema.")}
          </p>
        )}
      </Card>

      <Card className="max-w-2xl p-6">
        <h2 className="text-sm font-semibold">{t("Recursos")}</h2>
        <ul className="mt-3 divide-y" data-testid="lista-de-recursos">
          {RECURSOS.map((recurso) => {
            const ligado = temRecurso(e, recurso);
            const overrides = overridesDoRecurso(e, recurso);
            return (
              <li
                key={recurso}
                className="flex items-start justify-between gap-4 py-3"
                data-recurso={recurso}
                data-ligado={ligado ? "sim" : "nao"}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t(ROTULO_DO_RECURSO[recurso])}</span>
                    {sempreLigado(recurso) && (
                      <Badge variant="secondary">{t("sempre disponível")}</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t(DESCRICAO_DO_RECURSO[recurso])}
                  </p>
                  {overrides.map((o) => (
                    <p key={o.id} className="mt-1 text-xs text-muted-foreground">
                      {fraseDoOverride(o, idioma)}
                    </p>
                  ))}
                </div>
                <Badge variant={ligado ? "default" : "outline"}>
                  {ligado ? t("Incluído") : t("Não incluído")}
                </Badge>
              </li>
            );
          })}
        </ul>
      </Card>

      {consumo.length > 0 && (
        <Card className="max-w-2xl p-6" data-testid="limites">
          <h2 className="text-sm font-semibold">{t("Limites do plano")}</h2>
          <ul className="mt-3 divide-y">
            {consumo.map((m) => (
              <li key={m.chave} className="flex items-center justify-between gap-4 py-2" data-limite={m.chave}>
                <div>
                  <span className="font-medium">{t(LIMITES[m.chave].rotulo)}</span>
                  {!m.enforced && (
                    <span className="ml-2 text-xs text-muted-foreground">{t("informativo")}</span>
                  )}
                </div>
                <span className={m.excedido ? "text-sm text-error-fg" : "text-sm text-muted-foreground"}>
                  {m.uso} / {m.teto}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="max-w-2xl p-6">
        <h2 className="text-sm font-semibold">{t("Cobrança")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {suporte ? (
            <>
              {t("Para mudar de plano ou para questões de pagamento, contate")}{" "}
              <a className="underline" href={`mailto:${suporte}`}>
                {suporte}
              </a>
              .
            </>
          ) : (
            <>{t("Para mudar de plano ou para questões de pagamento, fale com quem administra este sistema.")}</>
          )}
        </p>
      </Card>
    </div>
  );
}

/**
 * "Liberado até 17/10/2026", "Bloqueado até alguém desfazer" — a frase que a
 * Central promete quando aponta para cá. Data no fuso de apresentação da
 * pessoa, no idioma dela.
 */
function fraseDoOverride(o: OverrideAtivo, idioma: Idioma): string {
  const verbo = o.mode === "enable" ? traduzir("Liberado", idioma) : traduzir("Bloqueado", idioma);
  if (!o.ends_at) return `${verbo} ${traduzir("até alguém desfazer", idioma)}`;
  const data = new Intl.DateTimeFormat(idioma, { dateStyle: "short" }).format(new Date(o.ends_at));
  return `${verbo} ${traduzir("até", idioma)} ${data}`;
}
