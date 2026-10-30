import { notFound } from "next/navigation";

import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { FormularioDoWidgetDeSuporte } from "./_form";

export const metadata = { title: "Widget de suporte da instalação" };
export const dynamic = "force-dynamic";

/**
 * Onde o dono da instalação configura o botão de suporte que aparece em todas as
 * telas logadas (migration 0289). Em `/admin`, e não em `/app/settings`, porque
 * o botão é da INSTALAÇÃO — o mesmo para todas as empresas. Irmã de `/admin/meta`.
 *
 * ⚠️ O segredo HMAC não vai ao cliente — nem cifrado. A leitura traz a coluna só
 * para saber SE existe.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();

  const { data, error } = await createAdminClient()
    .from("platform_support_widget" as never)
    .select("enabled, script_url, public_key, hmac_secret_encrypted")
    .eq("id", 1)
    .maybeSingle();

  const linha = data as {
    enabled: boolean;
    script_url: string | null;
    public_key: string | null;
    hmac_secret_encrypted: string | null;
  } | null;

  return (
    <FormularioDoWidgetDeSuporte
      ligado={Boolean(linha?.enabled)}
      scriptUrl={linha?.script_url ?? ""}
      chavePublica={linha?.public_key ?? ""}
      temSegredoSalvo={Boolean(linha?.hmac_secret_encrypted)}
      // Leitura que falhou não pode virar "nunca configurado".
      leituraFalhou={Boolean(error)}
    />
  );
}
