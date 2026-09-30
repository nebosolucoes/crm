/**
 * Conexões de Instagram Direct e Messenger — do lado de dentro do seam.
 *
 * Spec 21 §3. A rota e a tela falam em conceitos ("conectar o Instagram", "a
 * conexão", "desconectar"); quem transporta, como se chamam as colunas dele e
 * como se fala com a API dele moram aqui e em `./zernio/social.ts`. Mesma regra
 * de `./connect.ts`, pelo mesmo motivo: o `lint:channels`.
 *
 * ─── A conta é da INSTALAÇÃO ───────────────────────────────────────────────
 *
 * Decisão do dono (30/09): uma chave só, a da instalação (`ZERNIO_API_KEY` no
 * `.env`). Cada "Conectar" cria um profile NESSA conta, e cada "Desconectar"
 * remove a conta conectada e o profile de lá — o provedor cobra por conta
 * conectada, e uma conta esquecida do lado de lá é cobrança sem cliente. A
 * sessão não guarda chave: `resolveZernioCreds` usa a da instalação com o
 * `zernio_account_id` da própria sessão.
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { logger } from "@/lib/logger";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { CHANNEL_PROVIDER_ZERNIO } from "./capabilities";
import { PARTNER_CHANNEL_LABEL } from "./connect";
import { PLATAFORMAS_SOCIAIS, type PlataformaSocial, ROTULO_DA_PLATAFORMA } from "./plataformas";
import { emitirEstadoSocial, type EstadoSocial } from "./social-state";
import { zernioApiKeyDaInstalacao } from "./zernio/credentials";
import {
  contaDoProfile,
  criarProfile,
  nomeDoProfile,
  registrarWebhook,
  removerConta,
  removerProfile,
  removerWebhook,
  urlDeAutorizacao,
} from "./zernio/social";

/** A frase em português para o erro que o OAuth devolveu (vocabulário do provedor). */
export { explicarErroDoCallback } from "./zernio/social";

/** Onde o OAuth volta. O cookie de vínculo vive SÓ neste caminho. */
export const CAMINHO_DO_CALLBACK_SOCIAL = "/api/v1/channels/social/callback";

/** Como o provedor se chama para o usuário. */
export const SOCIAL_PROVIDER_LABEL = PARTNER_CHANNEL_LABEL;

/** O nome da variável que a tela cita quando ela falta. */
export const VARIAVEL_DA_CHAVE_SOCIAL = "ZERNIO_API_KEY";

const PROVIDER = CHANNEL_PROVIDER_ZERNIO;

export type ResultadoSocial<T = null> = { ok: true; valor: T } | { ok: false; motivo: string };

/** A instalação tem a chave do provedor? Sem ela, Instagram e Messenger ficam desligados. */
export function socialConfigurado(): boolean {
  return zernioApiKeyDaInstalacao() !== null;
}

function semChave(): ResultadoSocial<never> {
  return {
    ok: false,
    motivo: `Instagram e Messenger não estão configurados nesta instalação (falta ${VARIAVEL_DA_CHAVE_SOCIAL} no .env).`,
  };
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
export async function iniciarConexaoSocial(input: {
  organizationId: string;
  nomeDaOrganizacao: string;
  userId: string;
  authSessionId: string;
  plataforma: PlataformaSocial;
  /** Nosso callback, SEM o `state` — ele é acrescentado aqui. */
  callbackUrl: string;
}): Promise<ResultadoSocial<{ authUrl: string; nonce: string }>> {
  const apiKey = zernioApiKeyDaInstalacao();
  if (!apiKey) return semChave();

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
  const apiKey = zernioApiKeyDaInstalacao();
  if (!apiKey) return semChave();

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
    // A chave é da instalação: a sessão não guarda cópia (ver o cabeçalho).
    zernio_token_encrypted: null,
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
 * "Desconectar": remove a conexão DO LADO DO PROVEDOR — o webhook, a conta
 * conectada e o profile que o "Conectar" criou.
 *
 * Falha fechado, e é de propósito: a conta é cobrada enquanto existir lá. Se
 * o provedor não confirmou a remoção, a rota NÃO arquiva a sessão e diz o
 * porquê — arquivar mesmo assim faria o CRM mostrar "removida" enquanto a
 * cobrança segue. Já removida (404) conta como removida.
 *
 * `ok: true, valor: false` = a sessão não é deste provedor (nada a fazer aqui).
 */
export async function desconectarNoProvedor(
  admin: SupabaseClient,
  organizationId: string,
  sessionId: string,
): Promise<ResultadoSocial<boolean>> {
  const { data } = await admin
    .from("channel_sessions")
    .select("provider, platform, zernio_account_id, metadata")
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .maybeSingle();
  if (!data || data.provider !== PROVIDER || !(PLATAFORMAS_SOCIAIS as readonly unknown[]).includes(data.platform)) {
    return { ok: true, valor: false };
  }

  const apiKey = zernioApiKeyDaInstalacao();
  if (!apiKey) return semChave();

  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const webhookId = typeof meta.zernio_webhook_id === "string" ? meta.zernio_webhook_id : null;
  const profileId = typeof meta.zernio_profile_id === "string" ? meta.zernio_profile_id : null;

  if (webhookId) {
    const r = await removerWebhook(apiKey, webhookId);
    // Webhook que sobra não cobra: o token rotacionado no arquivamento já recusa
    // qualquer entrega. Loga e segue.
    if (!r.ok) logger.warn("[social] webhook não removido no provedor", { sessionId, detail: r.motivo });
  }

  const accountId = data.zernio_account_id as string | null;
  if (accountId) {
    const r = await removerConta(apiKey, accountId);
    if (!r.ok) return { ok: false, motivo: `O provedor não removeu a conta conectada: ${r.motivo}` };
  }

  if (profileId) {
    const r = await removerProfile(apiKey, profileId);
    // O profile vazio não é cobrado (a cobrança é por conta conectada); falhar
    // aqui deixaria a pessoa presa a um "não consigo desconectar" sem motivo.
    if (!r.ok) logger.warn("[social] profile não removido no provedor", { sessionId, detail: r.motivo });
  }

  return { ok: true, valor: true };
}
