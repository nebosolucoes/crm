/**
 * Conexão de Instagram Direct e Messenger pelo intermediário — as chamadas à
 * API dele, e nada mais.
 *
 * Spec 21 §3. Este arquivo não toca banco: recebe a chave já decifrada e
 * devolve o que o provedor disse, já traduzido para o vocabulário do CRM. Quem
 * grava é `lib/channels/social.ts`.
 *
 * ─── Um profile por conexão, e por quê ─────────────────────────────────────
 *
 * A doc do provedor é explícita: um profile guarda UM Instagram, e escolher
 * outro Instagram no mesmo profile APAGA as conversas do anterior. Reusar um
 * profile entre duas conexões seria perda de histórico no segundo clique.
 * Então cada "Conectar" cria o seu, com `Idempotency-Key` para que um duplo
 * clique não crie dois.
 *
 * ─── Rede do CRM × rede do provedor ────────────────────────────────────────
 *
 * O provedor chama o Messenger de `facebook` (é a página do Facebook que
 * conversa). O CRM diz `messenger`, porque é o nome que o operador reconhece
 * na tela de atendimento. A tradução mora aqui, nos dois sentidos.
 */
import { randomUUID } from "node:crypto";

import type { PlataformaSocial } from "../plataformas";
import { zernioBaseUrl } from "./credentials";

/** A rede do CRM → o nome que o provedor usa no path e no payload. */
export function redeDoProvedor(plataforma: PlataformaSocial): "instagram" | "facebook" {
  return plataforma === "messenger" ? "facebook" : "instagram";
}

/** O nome do provedor → a rede do CRM. `null` para o que não é DM social. */
export function plataformaDoProvedor(valor: unknown): PlataformaSocial | null {
  if (valor === "instagram") return "instagram";
  if (valor === "facebook") return "messenger";
  return null;
}

/**
 * Eventos que a conexão social assina. Só os que o CRM consome: assinar a mais
 * é pagar entrega (e retentativa) de evento que ninguém lê.
 *
 * `message.failed` não entra: a doc diz que ele nunca dispara para Instagram
 * nem Messenger — a recusa da Meta chega síncrona, na resposta do envio.
 */
export const EVENTOS_DA_CONEXAO_SOCIAL = [
  "message.received",
  "message.sent",
  "message.read",
  "message.delivered",
  "message.edited",
  "message.deleted",
  "account.connected",
  "account.disconnected",
] as const;

type Json = Record<string, unknown>;

export type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: string; status?: number };

async function chamar(
  apiKey: string,
  metodo: "GET" | "POST" | "PUT" | "DELETE",
  caminho: string,
  corpo?: Json,
  extras?: Record<string, string>,
): Promise<{ status: number; json: Json | null } | { status: 0; json: null }> {
  try {
    const res = await fetch(`${zernioBaseUrl()}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(corpo ? { "Content-Type": "application/json" } : {}),
        ...extras,
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      // Teto de espera: um provedor que pendura a conexão não pode pendurar a
      // tela de quem está conectando.
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as Json | null;
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

/** A frase do provedor, quando ele deu uma — senão o status. */
function explicar(status: number, json: Json | null): string {
  const erro = typeof json?.error === "string" ? json.error : null;
  const codigo = typeof json?.code === "string" ? json.code : null;
  if (erro && codigo) return `${codigo}: ${erro}`;
  return erro ?? codigo ?? `Provedor respondeu ${status}.`;
}

const SEM_REDE = "Não foi possível falar com o provedor. Tente de novo.";

/**
 * A chave presta, e ela alcança a caixa de entrada?
 *
 * São duas perguntas porque falham de formas diferentes: chave recusada é
 * 401; chave boa numa conta sem o recurso de inbox é 403 SÓ nos endpoints de
 * inbox. Gravar a chave sem a segunda conferência faria o operador conectar o
 * Instagram e nunca receber uma mensagem — o defeito silencioso que esta tela
 * existe para impedir.
 */
export async function validarChaveSocial(apiKey: string): Promise<Resultado<null>> {
  const contas = await chamar(apiKey, "GET", "/v1/accounts");
  if (contas.status === 0) return { ok: false, motivo: SEM_REDE };
  if (contas.status === 401 || contas.status === 403) {
    return { ok: false, motivo: "Chave recusada pelo provedor.", status: contas.status };
  }
  if (contas.status < 200 || contas.status >= 300) {
    return { ok: false, motivo: explicar(contas.status, contas.json), status: contas.status };
  }

  const inbox = await chamar(apiKey, "GET", "/v1/inbox/conversations?limit=1");
  if (inbox.status === 0) return { ok: false, motivo: SEM_REDE };
  if (inbox.status === 403) {
    return {
      ok: false,
      motivo: "A chave funciona, mas a conta do provedor não tem a caixa de entrada (inbox) liberada.",
      status: 403,
    };
  }
  // Qualquer outra resposta do inbox (inclusive 400 por parâmetro) prova que o
  // recurso existe para esta chave — o que se queria saber.
  return { ok: true, valor: null };
}

/** Cria o profile desta conexão. Ver o cabeçalho: um por conexão. */
export async function criarProfile(
  apiKey: string,
  nome: string,
  idempotencia: string = randomUUID(),
): Promise<Resultado<{ profileId: string }>> {
  const r = await chamar(apiKey, "POST", "/v1/profiles", { name: nome.slice(0, 80) }, { "Idempotency-Key": idempotencia });
  if (r.status === 0) return { ok: false, motivo: SEM_REDE };

  // Nome já existe no time: a doc devolve o id existente. Reusar é seguro SÓ
  // porque o nome carrega um sufixo único por tentativa (ver `nomeDoProfile`) —
  // colisão aqui é o duplo clique, não outra conexão.
  if (r.status === 409) {
    const existente = (r.json?.details as Json | undefined)?.existingProfileId;
    if (typeof existente === "string") return { ok: true, valor: { profileId: existente } };
  }
  if (r.status < 200 || r.status >= 300) return { ok: false, motivo: explicar(r.status, r.json), status: r.status };

  const id = (r.json?.profile as Json | undefined)?._id;
  if (typeof id !== "string") return { ok: false, motivo: "Provedor não devolveu o profile criado." };
  return { ok: true, valor: { profileId: id } };
}

/** Nome legível no painel do provedor, com sufixo que o torna único. */
export function nomeDoProfile(organizacao: string, plataforma: PlataformaSocial, sufixo: string): string {
  const rede = plataforma === "messenger" ? "Messenger" : "Instagram";
  return `${organizacao.slice(0, 50)} · ${rede} · ${sufixo.slice(0, 8)}`;
}

/** URL de autorização para onde o browser do operador vai. */
export async function urlDeAutorizacao(
  apiKey: string,
  input: { plataforma: PlataformaSocial; profileId: string; redirectUrl: string },
): Promise<Resultado<{ authUrl: string }>> {
  const q = new URLSearchParams({
    profileId: input.profileId,
    redirect_url: input.redirectUrl,
  });
  const r = await chamar(apiKey, "GET", `/v1/connect/${redeDoProvedor(input.plataforma)}?${q.toString()}`);
  if (r.status === 0) return { ok: false, motivo: SEM_REDE };
  if (r.status < 200 || r.status >= 300) return { ok: false, motivo: explicar(r.status, r.json), status: r.status };
  const authUrl = r.json?.authUrl;
  if (typeof authUrl !== "string" || !/^https:\/\//.test(authUrl)) {
    return { ok: false, motivo: "Provedor não devolveu o endereço de autorização." };
  }
  return { ok: true, valor: { authUrl } };
}

export interface ContaSocial {
  accountId: string;
  plataforma: PlataformaSocial;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  ativa: boolean;
}

/**
 * A conta que o callback anunciou, conferida NA FONTE.
 *
 * O `accountId` chega pela query string do redirect — isto é, passou pelo
 * browser. Gravá-lo sem perguntar ao provedor deixaria qualquer um que
 * montasse a URL amarrar à organização uma conta que não é dele. A pergunta
 * vai com a CHAVE da organização e restrita ao profile que esta tentativa
 * criou: só aparece o que é dela.
 */
export async function contaDoProfile(
  apiKey: string,
  input: { profileId: string; accountId: string; plataforma: PlataformaSocial },
): Promise<Resultado<ContaSocial>> {
  const q = new URLSearchParams({ profileId: input.profileId, platform: redeDoProvedor(input.plataforma) });
  const r = await chamar(apiKey, "GET", `/v1/accounts?${q.toString()}`);
  if (r.status === 0) return { ok: false, motivo: SEM_REDE };
  if (r.status < 200 || r.status >= 300) return { ok: false, motivo: explicar(r.status, r.json), status: r.status };

  const contas = Array.isArray(r.json?.accounts) ? (r.json.accounts as Json[]) : [];
  const conta = contas.find((c) => String(c._id ?? c.id) === input.accountId);
  if (!conta) return { ok: false, motivo: "A conta conectada não pertence a esta tentativa de conexão." };

  const plataforma = plataformaDoProvedor(conta.platform);
  if (plataforma !== input.plataforma) {
    return { ok: false, motivo: "A conta conectada é de outra rede." };
  }

  const texto = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    ok: true,
    valor: {
      accountId: input.accountId,
      plataforma,
      username: texto(conta.username),
      displayName: texto(conta.displayName),
      avatarUrl: texto(conta.profilePicture),
      ativa: conta.isActive !== false && conta.needsReconnection !== true,
    },
  };
}

/**
 * Registra o webhook DESTA conexão no provedor.
 *
 * Restrito à conta (`accountIds`): a mesma chave pode servir outras conexões
 * (o WhatsApp parceiro, outro Instagram), e sem o filtro cada uma receberia os
 * eventos de todas. A rota de entrada ainda confere a conta do payload — o
 * filtro aqui é economia, a conferência lá é a garantia.
 */
export async function registrarWebhook(
  apiKey: string,
  input: { nome: string; url: string; segredo: string; accountId: string },
): Promise<Resultado<{ webhookId: string }>> {
  const r = await chamar(apiKey, "POST", "/v1/webhooks/settings", {
    name: input.nome.slice(0, 50),
    url: input.url,
    secret: input.segredo,
    events: [...EVENTOS_DA_CONEXAO_SOCIAL],
    isActive: true,
    accountIds: [input.accountId],
  });
  if (r.status === 0) return { ok: false, motivo: SEM_REDE };
  if (r.status < 200 || r.status >= 300) return { ok: false, motivo: explicar(r.status, r.json), status: r.status };
  const id = (r.json?.webhook as Json | undefined)?._id;
  if (typeof id !== "string") return { ok: false, motivo: "Provedor não devolveu o webhook criado." };
  return { ok: true, valor: { webhookId: id } };
}

/** Remove o webhook. O id vai na QUERY — a doc recusa no corpo. */
export async function removerWebhook(apiKey: string, webhookId: string): Promise<Resultado<null>> {
  const r = await chamar(apiKey, "DELETE", `/v1/webhooks/settings?webhookId=${encodeURIComponent(webhookId)}`);
  if (r.status === 0) return { ok: false, motivo: SEM_REDE };
  // 404 = já não existe; é o desfecho que se queria.
  if (r.status === 404 || (r.status >= 200 && r.status < 300)) return { ok: true, valor: null };
  return { ok: false, motivo: explicar(r.status, r.json), status: r.status };
}

/**
 * O erro do callback em português.
 *
 * O vocabulário é do provedor (lido da doc em 29/09). Valor desconhecido cai
 * na frase genérica em vez de mostrar o código cru — a doc manda tratar o
 * desconhecido como falha genérica, e o operador não tem o que fazer com
 * `token_exchange_failed`.
 */
export function explicarErroDoCallback(erro: string, motivo?: string | null): string {
  switch (erro) {
    case "oauth_denied":
    case "access_denied":
      return "A autorização foi cancelada na tela do Facebook/Instagram.";
    case "personal_account_not_supported":
      return "Contas pessoais não recebem mensagens pela API. Converta o Instagram para conta profissional (comercial ou criador) e tente de novo.";
    case "no_facebook_pages":
      return motivo === "pages_permission_declined"
        ? "A permissão de páginas foi recusada. Tente de novo e marque a página na tela do Facebook."
        : "Nenhuma página do Facebook foi liberada para esta conexão. Tente de novo e selecione a página.";
    case "account_limit_exceeded":
    case "profile_limit_exceeded":
    case "payment_required":
      return "O plano da sua conta no provedor não comporta mais uma conexão. Verifique a cobrança no painel do provedor.";
    case "instagram_login_method_mismatch":
      return "Este Instagram já está ligado por outro método de login no provedor. Desconecte-o lá e tente de novo.";
    case "reconnect_account_mismatch":
      return "A conta escolhida é diferente da que estava conectada. Remova a conexão antiga e conecte de novo.";
    default:
      return "Não foi possível concluir a conexão. Tente de novo.";
  }
}
