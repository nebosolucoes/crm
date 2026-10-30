"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { invalidarWidgetDeSuporte } from "@/lib/suporte/widget";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export type UpdateWidgetDeSuporteResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

/**
 * Grava o widget de suporte DESTA INSTALAÇÃO (migration 0289).
 *
 * Gate `is_platform_admin`, escrita pelo admin client e segredo cifrado por
 * `fn_encrypt_oauth`: o mesmo desenho de `updateMetaApp.ts`, pelo mesmo motivo —
 * a tabela não tem policy nem grant para `authenticated`, e quem tem o segredo
 * se identifica no widget como qualquer usuário.
 *
 * O segredo é OPCIONAL na entrada: vazio mantém o que está gravado (a tela nunca
 * o mostra de volta). Sem segredo nenhum o widget funciona, mas os chamados
 * entram como "não verificados".
 */
const entradaSchema = z.object({
  enabled: z.boolean(),
  script_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "script_url_https"),
  public_key: z.string().trim().max(200),
  hmac_secret: z.string().trim().max(300).optional(),
  /** Apaga o segredo gravado (a identidade passa a ir sem verificação). */
  remover_segredo: z.boolean().optional(),
});

export type WidgetDeSuporteInput = z.infer<typeof entradaSchema>;

export async function updateWidgetDeSuporte(
  input: WidgetDeSuporteInput,
): Promise<UpdateWidgetDeSuporteResult> {
  const { user: authUser } = await requirePlatformAdmin();

  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", details: parsed.error.flatten() };
  }
  const { enabled, script_url, public_key, hmac_secret, remover_segredo } = parsed.data;

  // Ligar sem o endereço ou sem a chave seria salvar um botão que não aparece,
  // e a tela diria "salvo".
  if (enabled && (!script_url || !public_key)) {
    return { ok: false, error: "campos_obrigatorios" };
  }

  const admin = createAdminClient();
  const valores: Record<string, unknown> = {
    id: 1,
    enabled,
    script_url: script_url || null,
    public_key: public_key || null,
    updated_by: authUser.id,
  };

  if (hmac_secret) {
    const cifrado = await encryptWebhookSecret(admin, hmac_secret);
    if (!cifrado) {
      return {
        ok: false,
        error:
          "cifra indisponível nesta instalação (GUC app.nuvemshop_oauth_key ausente) — o segredo não foi gravado",
      };
    }
    valores.hmac_secret_encrypted = cifrado;
  } else if (remover_segredo) {
    valores.hmac_secret_encrypted = null;
  }

  // `upsert`, não `update`: a linha não existe numa instalação que nunca
  // configurou, e um `update` casaria zero linhas devolvendo sucesso.
  const { error } = await admin
    .from("platform_support_widget" as never)
    .upsert(valores as never, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };

  invalidarWidgetDeSuporte();

  const cabecalhos = await headers();
  await audit({
    action: "platform_support_widget.updated",
    actorUserId: authUser.id,
    resourceType: "platform_support_widget",
    // `null`, não `"1"`: `resource_id` é uuid (ver `updateMetaApp.ts`).
    resourceId: null,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    actingAsPlatformAdmin: true,
    // O QUE mudou, jamais o segredo.
    metadata: {
      enabled,
      script_url: script_url || null,
      segredo_trocado: Boolean(hmac_secret),
      segredo_removido: !hmac_secret && Boolean(remover_segredo),
    },
  });

  return { ok: true };
}
