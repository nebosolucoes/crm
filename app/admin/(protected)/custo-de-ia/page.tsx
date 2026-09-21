import { notFound } from "next/navigation";

import { loadAuthUser } from "@/lib/auth/server";
import { exibicaoDoCusto } from "@/lib/ai/custo/exibicao-da-instalacao";
import { traduzir } from "@/lib/i18n/dicionario";

import { FormularioDeCustoDeIa } from "./_form";

export const metadata = { title: "Custo de IA" };
export const dynamic = "force-dynamic";

/**
 * A tela onde o dono da instalação decide em que moeda — e com que margem — o
 * custo de IA é mostrado a todas as organizações que ele hospeda.
 *
 * ── Por que `/admin`, e não `/app/settings` ─────────────────────────────────
 *
 * O objeto é a INSTALAÇÃO. A cotação e a margem são de quem revende o agente;
 * deixar o admin de um tenant mexer nelas mudaria o número que os OUTROS
 * tenants leem — e a margem é exatamente o que o cliente não configura. Mesmo
 * argumento de `/admin/marca` e `/admin/cadastro`, irmãs desta tela.
 *
 * ── O que NÃO muda ──────────────────────────────────────────────────────────
 *
 * O banco segue em dólar (`cost_cents`, teto, gate de orçamento). Esta tela só
 * decide a LEITURA. Ver `lib/ai/custo/moeda.ts`.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Custo de IA", usuario.idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Em que moeda, e com que margem, o gasto com IA aparece para as empresas desta instalação.",
            usuario.idioma,
          )}
        </p>
      </div>
      <FormularioDeCustoDeIa inicial={await exibicaoDoCusto()} />
    </div>
  );
}
