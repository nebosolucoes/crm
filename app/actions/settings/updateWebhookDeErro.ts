"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enderecoPermitido,
  entregar,
  invalidarWebhookDeErro,
  webhookGravado,
} from "@/lib/suporte/webhook-de-erro";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export type UpdateWebhookDeErroResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export type TesteDoWebhookDeErroResult =
  | { ok: true; status: number }
  | { ok: false; error: string; status?: number | null };

/**
 * Grava o webhook de erro DESTA INSTALAÇÃO (migration 0290). Mesmo desenho de
 * `updateWidgetDeSuporte.ts`: gate `is_platform_admin`, admin client, segredo
 * cifrado por `fn_encrypt_oauth`, vazio = mantém o gravado.
 */
const entradaSchema = z.object({
  enabled: z.boolean(),
  url: z.string().trim().max(1000),
  scope: z.enum(["all", "server"]),
  secret: z.string().trim().max(500).optional(),
  remover_segredo: z.boolean().optional(),
});

export type WebhookDeErroInput = z.infer<typeof entradaSchema>;

export async function updateWebhookDeErro(input: WebhookDeErroInput): Promise<UpdateWebhookDeErroResult> {
  const { user: authUser } = await requirePlatformAdmin();

  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", details: parsed.error.flatten() };
  }
  const { enabled, url, scope, secret, remover_segredo } = parsed.data;

  if (enabled && !url) return { ok: false, error: "url_obrigatoria" };
  if (url && !enderecoPermitido(url)) return { ok: false, error: "url_nao_permitida" };

  const admin = createAdminClient();
  const valores: Record<string, unknown> = {
    id: 1,
    enabled,
    url: url || null,
    scope,
    updated_by: authUser.id,
  };

  if (secret) {
    const cifrado = await encryptWebhookSecret(admin, secret);
    if (!cifrado) {
      return {
        ok: false,
        error:
          "cifra indisponível nesta instalação (GUC app.nuvemshop_oauth_key ausente) — o segredo não foi gravado",
      };
    }
    valores.secret_encrypted = cifrado;
  } else if (remover_segredo) {
    valores.secret_encrypted = null;
  }

  const { error } = await admin
    .from("platform_error_webhook" as never)
    .upsert(valores as never, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };

  invalidarWebhookDeErro();

  const cabecalhos = await headers();
  await audit({
    action: "platform_error_webhook.updated",
    actorUserId: authUser.id,
    resourceType: "platform_error_webhook",
    resourceId: null,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    actingAsPlatformAdmin: true,
    // O QUE mudou, jamais o segredo. O host basta para saber para onde vão os erros.
    metadata: {
      enabled,
      scope,
      host: url ? new URL(url).host : null,
      segredo_trocado: Boolean(secret),
      segredo_removido: !secret && Boolean(remover_segredo),
    },
  });

  return { ok: true };
}

/**
 * Manda um erro de TESTE para o endereço GRAVADO (ligado ou não), e diz o que o
 * destino respondeu. É o que prova, pela tela, que o card vai abrir.
 */
export async function testarWebhookDeErro(): Promise<TesteDoWebhookDeErroResult> {
  const { user: authUser } = await requirePlatformAdmin();
  const destino = await webhookGravado();
  if (!destino) return { ok: false, error: "nada_gravado" };

  const r = await entregar(destino, {
    requestId: `teste-${randomUUID()}`,
    status: 500,
    code: "teste_do_webhook_de_erro",
    message: "Erro de teste enviado em Admin › Webhook de erro. Se este card abriu, a integração está funcionando.",
    method: "POST",
    path: "/admin/webhook-de-erro",
    details: null,
    usuario: { id: authUser.id, email: authUser.email ?? null, nome: null },
    quando: new Date(),
  });
  if (r.ok && r.status !== null) return { ok: true, status: r.status };
  return { ok: false, error: r.falha ?? "destino_recusou", status: r.status };
}
