import { notFound } from "next/navigation";

import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { FormularioDoWebhookDeErro } from "./_form";

export const metadata = { title: "Webhook de erro da instalação" };
export const dynamic = "force-dynamic";

/**
 * Onde o dono da instalação diz para onde vai cada erro da API (migration 0290):
 * tipicamente o webhook de uma central de chamados, que abre um card por erro.
 * Em `/admin` porque o destino é da INSTALAÇÃO. Irmã de `/admin/suporte`.
 *
 * ⚠️ O segredo não vai ao cliente — nem cifrado. Só SE existe.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();

  const { data, error } = await createAdminClient()
    .from("platform_error_webhook" as never)
    .select("enabled, url, scope, secret_encrypted")
    .eq("id", 1)
    .maybeSingle();

  const linha = data as {
    enabled: boolean;
    url: string | null;
    scope: string;
    secret_encrypted: string | null;
  } | null;

  return (
    <FormularioDoWebhookDeErro
      ligado={Boolean(linha?.enabled)}
      url={linha?.url ?? ""}
      escopo={linha?.scope === "server" ? "server" : "all"}
      temSegredoSalvo={Boolean(linha?.secret_encrypted)}
      leituraFalhou={Boolean(error)}
    />
  );
}
