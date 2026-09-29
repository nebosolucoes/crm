/**
 * Conexões de Instagram Direct e Messenger — do lado de dentro do seam.
 *
 * Spec 21 §3. A rota e a tela falam em conceitos ("a chave", "conectar o
 * Instagram", "a conexão"); quem transporta, como se chamam as colunas dele e
 * como se fala com a API dele moram aqui e em `./zernio/social.ts`. Mesma regra
 * de `./connect.ts`, pelo mesmo motivo: o `lint:channels`.
 *
 * ─── A chave é da ORGANIZAÇÃO; a cópia é da SESSÃO ─────────────────────────
 *
 * O operador cola a chave uma vez (`channel_provider_keys`). Cada conexão
 * copia a cifra para `zernio_token_encrypted` da própria sessão, porque é de
 * lá que envio, mídia e saúde já leem (`resolveZernioCreds`). Trocar a chave
 * depois NÃO reescreve as sessões antigas por conta própria — `salvarChaveSocial`
 * propaga explicitamente, e diz quantas.
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { logger } from "@/lib/logger";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { CHANNEL_PROVIDER_ZERNIO } from "./capabilities";
import { PARTNER_CHANNEL_LABEL } from "./connect";
import { PLATAFORMAS_SOCIAIS, type PlataformaSocial, ROTULO_DA_PLATAFORMA } from "./plataformas";
import { emitirEstadoSocial, type EstadoSocial } from "./social-state";
import {
  contaDoProfile,
  criarProfile,
  nomeDoProfile,
  registrarWebhook,
  removerWebhook,
  urlDeAutorizacao,
  validarChaveSocial,
} from "./zernio/social";

/** A frase em português para o erro que o OAuth devolveu (vocabulário do provedor). */
export { explicarErroDoCallback } from "./zernio/social";

/** Onde o OAuth volta. O cookie de vínculo vive SÓ neste caminho. */
export const CAMINHO_DO_CALLBACK_SOCIAL = "/api/v1/channels/social/callback";

/** Como o provedor se chama para o usuário (o nome da conta que ele contratou). */
export const SOCIAL_PROVIDER_LABEL = PARTNER_CHANNEL_LABEL;

const PROVIDER = CHANNEL_PROVIDER_ZERNIO;

// ---------------------------------------------------------------------------
// A chave da organização
// ---------------------------------------------------------------------------

export async function temChaveSocial(admin: SupabaseClient, organizationId: string): Promise<boolean> {
  const { data } = await admin
    .from("channel_provider_keys")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return !!data;
}

async function chaveCifrada(admin: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data } = await admin
    .from("channel_provider_keys")
    .select("api_key_encrypted")
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return (data?.api_key_encrypted as string | undefined) ?? null;
}

async function lerChaveSocial(admin: SupabaseClient, organizationId: string): Promise<string | null> {
  const cifrada = await chaveCifrada(admin, organizationId);
  return cifrada ? decryptWebhookSecret(admin, cifrada) : null;
}

export type ResultadoSocial<T = null> = { ok: true; valor: T } | { ok: false; motivo: string };

/**
 * Valida contra o provedor e só então grava. Propaga a cifra nova às sessões
 * sociais já conectadas — trocar a chave e continuar mandando pela velha
 * (revogada) seria o defeito calado clássico.
 */
export async function salvarChaveSocial(
  admin: SupabaseClient,
  input: { organizationId: string; apiKey: string; userId: string },
): Promise<ResultadoSocial<{ sessoesAtualizadas: number }>> {
  const apiKey = input.apiKey.trim();
  const v = await validarChaveSocial(apiKey);
  if (!v.ok) return { ok: false, motivo: v.motivo };

  const cifrada = await encryptWebhookSecret(admin, apiKey);
  if (!cifrada) {
    return { ok: false, motivo: "Cifra indisponível nesta instalação — a chave não foi gravada." };
  }

  const { error } = await admin.from("channel_provider_keys").upsert(
    {
      organization_id: input.organizationId,
      provider: PROVIDER,
      api_key_encrypted: cifrada,
      created_by: input.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider" },
  );
  if (error) return { ok: false, motivo: error.message };

  const { data: atualizadas } = await admin
    .from("channel_sessions")
    .update({ zernio_token_encrypted: cifrada })
    .eq("organization_id", input.organizationId)
    .eq("provider", PROVIDER)
    .in("platform", [...PLATAFORMAS_SOCIAIS])
    .is("archived_at", null)
    .select("id");

  return { ok: true, valor: { sessoesAtualizadas: (atualizadas ?? []).length } };
}

/**
 * Quem clicou em "Conectar" AINDA pode conectar canal nesta organização?
 *
 * O callback chega sem cookie de sessão (ver `EstadoSocial.authSessionId`),
 * então a autorização é refeita aqui, no banco, com o que o `state` assinado
 * garante: organização e usuário. Dez minutos bastam para alguém perder o
 * papel de admin — e conectar canal é decisão de dono.
 */
export async function atorAindaPodeConectar(
  admin: SupabaseClient,
  estado: Pick<EstadoSocial, "orgId" | "userId">,
): Promise<boolean> {
  const { data: vinculo } = await admin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", estado.orgId)
    .eq("user_id", estado.userId)
    .not("accepted_at", "is", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (vinculo?.role === "admin") return true;

  const { data: plataforma } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", estado.userId)
    // Suporte somente leitura não conecta canal na organização de ninguém.
    .eq("scope", "full")
    .is("revoked_at", null)
    .maybeSingle();
  return !!plataforma;
}

// ---------------------------------------------------------------------------
// As conexões
// ---------------------------------------------------------------------------

export interface ConexaoSocial {
  id: string;
  plataforma: PlataformaSocial;
  rotulo: string;
  nome: string | null;
  usuario: string | null;
  avatarUrl: string | null;
  status: string | null;
  criadaEm: string;
}

export async function listarConexoesSociais(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ConexaoSocial[]> {
  const { data } = await admin
    .from("channel_sessions")
    .select("id, platform, display_name, status, metadata, created_at")
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER)
    .in("platform", [...PLATAFORMAS_SOCIAIS])
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => {
    const plataforma = row.platform as PlataformaSocial;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const texto = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
    return {
      id: row.id as string,
      plataforma,
      rotulo: ROTULO_DA_PLATAFORMA[plataforma],
      nome: (row.display_name as string | null) ?? null,
      usuario: texto(meta.social_username),
      avatarUrl: texto(meta.social_avatar_url),
      status: (row.status as string | null) ?? null,
      criadaEm: row.created_at as string,
    };
  });
}

/**
 * Primeiro passo: cria o profile desta conexão e devolve para onde mandar o
 * browser. Nada é gravado no CRM ainda — se o operador desistir na tela do
 * Facebook, não sobra sessão fantasma.
 */
export async function iniciarConexaoSocial(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    nomeDaOrganizacao: string;
    userId: string;
    authSessionId: string;
    plataforma: PlataformaSocial;
    /** Nosso callback, SEM o `state` — ele é acrescentado aqui. */
    callbackUrl: string;
  },
): Promise<ResultadoSocial<{ authUrl: string; nonce: string }>> {
  const apiKey = await lerChaveSocial(admin, input.organizationId);
  if (!apiKey) return { ok: false, motivo: "Cadastre a chave de API antes de conectar." };

  const sufixo = randomUUID();
  const profile = await criarProfile(
    apiKey,
    nomeDoProfile(input.nomeDaOrganizacao, input.plataforma, sufixo),
    sufixo,
  );
  if (!profile.ok) return { ok: false, motivo: profile.motivo };

  const { state, nonce } = emitirEstadoSocial({
    orgId: input.organizationId,
    userId: input.userId,
    authSessionId: input.authSessionId,
    plataforma: input.plataforma,
    profileId: profile.valor.profileId,
  });
  const retorno = new URL(input.callbackUrl);
  retorno.searchParams.set("state", state);

  const auth = await urlDeAutorizacao(apiKey, {
    plataforma: input.plataforma,
    profileId: profile.valor.profileId,
    redirectUrl: retorno.toString(),
  });
  if (!auth.ok) return { ok: false, motivo: auth.motivo };
  return { ok: true, valor: { authUrl: auth.valor.authUrl, nonce } };
}

/**
 * Segundo passo, no retorno do OAuth: confere a conta NA FONTE, grava a
 * sessão e registra o webhook. O operador não cola nada.
 *
 * A ordem é a de "o que dá para desfazer": o webhook é registrado ANTES de
 * gravar a sessão, e removido se a gravação falhar. Sessão sem webhook é canal
 * que envia e nunca recebe; webhook sem sessão é só uma entrega recusada por
 * token desconhecido.
 */
export async function concluirConexaoSocial(
  admin: SupabaseClient,
  input: {
    estado: EstadoSocial;
    accountId: string;
    /** `(token) => URL pública do webhook`, montada pela rota que conhece o host. */
    urlDoWebhook: (token: string) => string;
  },
): Promise<ResultadoSocial<{ sessionId: string; plataforma: PlataformaSocial }>> {
  const { estado } = input;
  const cifrada = await chaveCifrada(admin, estado.orgId);
  const apiKey = cifrada ? await decryptWebhookSecret(admin, cifrada) : null;
  if (!cifrada || !apiKey) return { ok: false, motivo: "A chave de API sumiu durante a conexão. Cadastre de novo." };

  const conta = await contaDoProfile(apiKey, {
    profileId: estado.profileId,
    accountId: input.accountId,
    plataforma: estado.plataforma,
  });
  if (!conta.ok) return { ok: false, motivo: conta.motivo };

  const segredo = randomBytes(32).toString("hex");
  const segredoCifrado = await encryptWebhookSecret(admin, segredo);
  if (!segredoCifrado) return { ok: false, motivo: "Cifra indisponível nesta instalação." };

  // Reconectar a MESMA conta reaproveita a linha: agente, roteador e histórico
  // continuam amarrados a ela. O índice único de `zernio_account_id` ativo
  // recusaria uma segunda linha de qualquer forma.
  const { data: existente } = await admin
    .from("channel_sessions")
    .select("id, webhook_path_token, metadata")
    .eq("organization_id", estado.orgId)
    .eq("zernio_account_id", input.accountId)
    .is("archived_at", null)
    .maybeSingle();

  const token = (existente?.webhook_path_token as string | undefined) ?? randomBytes(16).toString("hex");
  const rotulo = ROTULO_DA_PLATAFORMA[estado.plataforma];

  const webhook = await registrarWebhook(apiKey, {
    nome: `CRM ${rotulo} ${conta.valor.username ?? input.accountId}`,
    url: input.urlDoWebhook(token),
    segredo,
    accountId: input.accountId,
  });
  if (!webhook.ok) return { ok: false, motivo: `Não foi possível registrar o webhook: ${webhook.motivo}` };

  const metaAnterior = (existente?.metadata ?? {}) as Record<string, unknown>;
  const webhookAntigo = typeof metaAnterior.zernio_webhook_id === "string" ? metaAnterior.zernio_webhook_id : null;
  const metadata = {
    ...(existente ? metaAnterior : metadataInicialDoCanal()),
    zernio_profile_id: estado.profileId,
    zernio_webhook_id: webhook.valor.webhookId,
    social_username: conta.valor.username,
    social_avatar_url: conta.valor.avatarUrl,
  };

  const linha = {
    organization_id: estado.orgId,
    provider: PROVIDER,
    platform: estado.plataforma,
    zernio_account_id: input.accountId,
    zernio_token_encrypted: cifrada,
    webhook_path_token: token,
    webhook_secret_encrypted: segredoCifrado,
    display_name: conta.valor.displayName ?? (conta.valor.username ? `@${conta.valor.username}` : rotulo),
    status: conta.valor.ativa ? "WORKING" : "FAILED",
    created_by: estado.userId,
    metadata,
    archived_at: null,
  };

  const gravacao = existente
    ? await admin.from("channel_sessions").update(linha).eq("id", existente.id as string).select("id").single()
    : await admin.from("channel_sessions").insert(linha).select("id").single();

  if (gravacao.error || !gravacao.data) {
    await removerWebhook(apiKey, webhook.valor.webhookId);
    return { ok: false, motivo: gravacao.error?.message ?? "Não foi possível gravar a conexão." };
  }

  // O webhook antigo da mesma conta assinava com o segredo que acabou de ser
  // trocado: deixá-lo vivo seria uma entrega recusada por minuto, para sempre.
  if (webhookAntigo && webhookAntigo !== webhook.valor.webhookId) {
    const r = await removerWebhook(apiKey, webhookAntigo);
    if (!r.ok) logger.warn("[social] webhook antigo não removido", { detail: r.motivo });
  }

  return { ok: true, valor: { sessionId: gravacao.data.id as string, plataforma: estado.plataforma } };
}

/**
 * Ao remover a conexão: apaga o webhook do lado do provedor. Best-effort — a
 * remoção no CRM já rotaciona o token do webhook, então uma falha aqui só deixa
 * entregas que serão recusadas, nunca mensagem entrando num canal removido.
 */
export async function revogarConexaoSocialNoProvedor(
  admin: SupabaseClient,
  organizationId: string,
  sessionId: string,
): Promise<void> {
  const { data } = await admin
    .from("channel_sessions")
    .select("provider, platform, metadata")
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .maybeSingle();
  if (!data || data.provider !== PROVIDER) return;
  const webhookId = ((data.metadata ?? {}) as Record<string, unknown>).zernio_webhook_id;
  if (typeof webhookId !== "string") return;

  const apiKey = await lerChaveSocial(admin, organizationId);
  if (!apiKey) return;
  const r = await removerWebhook(apiKey, webhookId);
  if (!r.ok) logger.warn("[social] webhook não removido no provedor", { sessionId, detail: r.motivo });
}
