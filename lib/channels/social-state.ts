/**
 * `state` do OAuth da conexão social — a prova de que o callback é a volta de
 * um clique DESTA organização, DESTE usuário, nos últimos 10 minutos.
 *
 * Mesmo desenho de `lib/nuvemshop/state.ts` (HMAC-SHA256 com INTERNAL_SECRET,
 * já obrigatório no env), com um carimbo de finalidade na assinatura: um
 * `state` emitido para outra integração não vale aqui, mesmo sendo da mesma
 * instalação e da mesma chave.
 *
 * O `state` viaja na query do NOSSO `redirect_url` — o provedor o devolve
 * intacto porque não conhece o parâmetro (a doc: "an existing query string is
 * kept").
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { PLATAFORMAS_SOCIAIS, type PlataformaSocial } from "./plataformas";
import type { EntregaDaConexao } from "./zernio/social";

const TTL_MS = 10 * 60 * 1000;
const FINALIDADE = "conexao-social-v1";

let chaveDeFallback: string | null = null;

function chave(): string {
  const segredo = process.env.INTERNAL_SECRET || "";
  if (segredo.length >= 16) return segredo;
  // Dev sem segredo: chave por processo. O fluxo funciona dentro de um mesmo
  // processo; reiniciar invalida as tentativas em aberto. Mesmo trade-off do
  // state da loja.
  if (!chaveDeFallback) chaveDeFallback = randomBytes(32).toString("hex");
  return chaveDeFallback;
}

export interface EstadoSocial {
  orgId: string;
  userId: string;
  /**
   * A sessão de login que clicou em "Conectar". O callback chega SEM cookie
   * (a sessão é `SameSite=Strict` e a volta vem do Facebook), então é por aqui
   * que o modo de suporte somente leitura é reconferido no retorno.
   */
  authSessionId: string;
  plataforma: PlataformaSocial;
  profileId: string;
  /**
   * Nonce da tentativa. O cookie de vínculo (`crm_oauth_bind`, SameSite=Lax)
   * carrega a assinatura dele: é o que prova que o navegador que volta do
   * Facebook é o mesmo que clicou em "Conectar" — sem isso, alguém mandaria a
   * vítima autorizar o Instagram DELA na organização de quem atacou.
   */
  nonce: string;
  /**
   * O que a conexão vai entregar para a inbox (spec 22 §4), escolhido na tela
   * ANTES de ir para a Meta. Viaja assinado para o callback não confiar na
   * query de volta.
   */
  entrega: EntregaDaConexao;
  exp: number;
}

/** Conexão nova, sem escolha explícita: as duas portas abertas. */
export const ENTREGA_PADRAO_DE_CONEXAO_NOVA: EntregaDaConexao = { direct: true, comentarios: true };

function assinar(corpo: string): string {
  return createHmac("sha256", chave()).update(`${FINALIDADE}.${corpo}`, "utf8").digest("hex");
}

export function emitirEstadoSocial(
  input: Omit<EstadoSocial, "exp" | "nonce">,
  agora = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  const corpo = Buffer.from(JSON.stringify({ ...input, nonce, exp: agora + TTL_MS }), "utf8").toString("base64url");
  return { state: `${corpo}.${assinar(corpo)}`, nonce };
}

export function conferirEstadoSocial(token: string | null | undefined, agora = Date.now()): EstadoSocial | null {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes as [string, string];

  const esperada = Buffer.from(assinar(corpo), "hex");
  const recebida = Buffer.from(assinatura, "hex");
  if (recebida.length !== esperada.length || recebida.length === 0) return null;
  if (!timingSafeEqual(recebida, esperada)) return null;

  let dado: Record<string, unknown>;
  try {
    dado = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const { orgId, userId, authSessionId, plataforma, profileId, nonce, exp, entrega } = dado;
  if (typeof orgId !== "string" || typeof userId !== "string" || typeof profileId !== "string") return null;
  if (typeof authSessionId !== "string" || typeof nonce !== "string") return null;
  if (typeof exp !== "number" || agora > exp) return null;
  if (!(PLATAFORMAS_SOCIAIS as readonly unknown[]).includes(plataforma)) return null;

  return {
    orgId,
    userId,
    authSessionId,
    plataforma: plataforma as PlataformaSocial,
    profileId,
    nonce,
    entrega: lerEntrega(entrega),
    exp,
  };
}

/** `state` emitido antes da spec 22 não traz a escolha: vale o padrão de conexão nova. */
function lerEntrega(valor: unknown): EntregaDaConexao {
  if (!valor || typeof valor !== "object") return ENTREGA_PADRAO_DE_CONEXAO_NOVA;
  const v = valor as Record<string, unknown>;
  const direct = v.direct !== false;
  const comentarios = v.comentarios !== false;
  return direct || comentarios ? { direct, comentarios } : ENTREGA_PADRAO_DE_CONEXAO_NOVA;
}
