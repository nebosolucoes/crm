/**
 * O registro de LIMITES de plano — a ÚNICA lista de chaves.
 *
 * Um limite é um número que o plano (ou um override) impõe a uma organização:
 * quantos canais, quantos usuários, quantos agentes. Vive num `jsonb` plano
 * (`platform_plans.limits` e `organization_feature_overrides.limits`), e este
 * arquivo é o que impede o anti-pattern nº 6 do CLAUDE.md (jsonb lock-in): a
 * tela e o banco só conhecem as chaves declaradas aqui, e `lerLimites()` é a
 * única porta de leitura.
 *
 * ─── O que este arquivo NÃO faz (ainda) ─────────────────────────────────────
 *
 * Não mede nem bloqueia — quem mede é `consumo.ts`, e quem barra é a rota de
 * criação (`recusaPorLimite`, em `exigir-na-rota.ts`). Cada chave declara se
 * há código barrando (`enforced`): `true` só quando uma rota recusa a criação
 * além do teto, e a tela do admin mostra "informativo" nas outras, para não
 * prometer uma parada que não acontece. É a mesma decisão do teto de
 * orçamento de IA (`gasto_incompleto` em `lib/ai/budget/check.ts`): controle
 * que o processo ignora é pior que nenhum.
 *
 * ─── Semântica dos valores ──────────────────────────────────────────────────
 *
 *   ausente  → sem limite
 *   `null`   → sem limite, dito de propósito — é como um override REMOVE um
 *              limite que o plano impõe (a mescla é por chave, e `null` vence
 *              o número de baixo)
 *   número   → o teto; inteiro, ≥ 0
 *
 * Client-safe: só zod (já vai para o bundle por outros schemas) e o vocabulário.
 */
import { z } from "zod";

import type { Recurso } from "./recursos";

export const CHAVES_DE_LIMITE = [
  "max_channels",
  "max_users",
  "max_ai_agents",
  "broadcast_monthly_sends",
  "max_contacts",
  "max_sectors",
  // Por rede (spec 21 §10, decisão do dono 30/09). Somam-se ao `max_channels`,
  // que segue sendo o teto TOTAL: a empresa respeita os dois.
  "max_whatsapp",
  "max_instagram",
  "max_messenger",
] as const;
export type ChaveDeLimite = (typeof CHAVES_DE_LIMITE)[number];

/**
 * As chaves que aceitam CONEXÕES EXTRAS por empresa (`organization_limit_extras`,
 * migration 0281): o admin da instalação vende "+N" que SOMA ao plano. Espelha
 * o CHECK da coluna `limit_key` — vigiado por
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 */
export const CHAVES_COM_EXTRA = ["max_channels", "max_whatsapp", "max_instagram", "max_messenger"] as const;
export type ChaveComExtra = (typeof CHAVES_COM_EXTRA)[number];

export interface LimiteMeta {
  chave: ChaveDeLimite;
  /** O recurso a que o limite pertence — sem ele ligado, o limite não tem sobre o que valer. */
  recurso: Recurso;
  rotulo: string;
  descricao: string;
  /** `quantidade` é um estoque (quantos existem); `por_mes` zera na virada do mês. */
  unidade: "quantidade" | "por_mes";
  /** `true` só quando existe código que RECUSA a criação além do teto. Ver o cabeçalho. */
  enforced: boolean;
}

export const LIMITES: Record<ChaveDeLimite, LimiteMeta> = {
  max_channels: {
    chave: "max_channels",
    recurso: "channels",
    rotulo: "Canais conectados",
    descricao: "Quantos números ou canais a organização pode manter conectados ao mesmo tempo.",
    unidade: "quantidade",
    // Barra em POST /channel-sessions, /channels/official e /channels/partner.
    enforced: true,
  },
  max_users: {
    chave: "max_users",
    recurso: "channels",
    rotulo: "Usuários",
    descricao: "Quantas pessoas podem ter acesso ativo à organização (convites pendentes contam).",
    unidade: "quantidade",
    // Barra em POST /team/invite.
    enforced: true,
  },
  max_ai_agents: {
    chave: "max_ai_agents",
    recurso: "ai_agents",
    rotulo: "Agentes de IA",
    descricao: "Quantos agentes podem existir na organização, publicados ou não.",
    unidade: "quantidade",
    // Barra em POST /ai/agents.
    enforced: true,
  },
  broadcast_monthly_sends: {
    chave: "broadcast_monthly_sends",
    recurso: "broadcast",
    rotulo: "Disparos por mês",
    descricao: "Quantas execuções de disparo a organização pode fazer no mês.",
    unidade: "por_mes",
    enforced: false,
  },
  max_contacts: {
    chave: "max_contacts",
    recurso: "crm",
    rotulo: "Contatos",
    descricao: "Quantos contatos a organização pode ter cadastrados.",
    unidade: "quantidade",
    enforced: false,
  },
  max_sectors: {
    chave: "max_sectors",
    recurso: "inbox",
    rotulo: "Setores de atendimento",
    descricao: "Quantos setores ativos (financeiro, comercial…) a organização pode ter. 0 = plano sem setores.",
    unidade: "quantidade",
    // Barra em POST /sectors (spec 20 §2.3).
    enforced: true,
  },
  max_whatsapp: {
    chave: "max_whatsapp",
    recurso: "channels",
    rotulo: "Conexões de WhatsApp",
    descricao: "Quantos números de WhatsApp (QR, API oficial ou parceiro) a organização pode manter conectados.",
    unidade: "quantidade",
    // Barra em POST /channel-sessions, /channels/official e /channels/partner.
    enforced: true,
  },
  max_instagram: {
    chave: "max_instagram",
    recurso: "channels",
    rotulo: "Contas de Instagram",
    descricao: "Quantas contas de Instagram Direct a organização pode manter conectadas.",
    unidade: "quantidade",
    // Barra em POST /channels/social/connect e na volta do OAuth.
    enforced: true,
  },
  max_messenger: {
    chave: "max_messenger",
    recurso: "channels",
    rotulo: "Páginas do Messenger",
    descricao: "Quantas páginas do Facebook (Messenger) a organização pode manter conectadas.",
    unidade: "quantidade",
    // Barra em POST /channels/social/connect e na volta do OAuth.
    enforced: true,
  },
};

/**
 * `max_users` e `max_channels` apontam para `channels` porque são limites da
 * ORGANIZAÇÃO inteira, e `channels` é o recurso que toda organização tem — é o
 * único lugar onde um limite "de todo mundo" pode morar sem inventar um
 * pseudo-recurso. Escrito aqui para ninguém "corrigir" para `inbox`.
 */
export const LIMITE_VALOR = z.number().int().nonnegative().nullable();
export const limitesSchema = z.partialRecord(z.enum(CHAVES_DE_LIMITE), LIMITE_VALOR);
export type Limites = z.infer<typeof limitesSchema>;

/**
 * Leitura TOLERANTE do jsonb: chave desconhecida ou valor inválido é descartado
 * em silêncio, nunca lança. Um plano gravado por uma versão mais nova (com uma
 * chave que esta ainda não conhece) não pode derrubar o layout de quem está na
 * versão velha — é a mesma decisão de `lerInterface()` e `lerEntitlements()`.
 */
export function lerLimites(raw: unknown): Limites {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const saida: Limites = {};
  for (const chave of CHAVES_DE_LIMITE) {
    if (!(chave in raw)) continue;
    const valor = (raw as Record<string, unknown>)[chave];
    const parsed = LIMITE_VALOR.safeParse(valor);
    if (parsed.success) saida[chave] = parsed.data;
  }
  return saida;
}

/**
 * Mescla por chave, a camada de cima vencendo — inclusive com `null`, que é o
 * jeito de um override dizer "sem limite" sobre um plano que tem. Ordem:
 * `mesclarLimites(plano, override1, override2)`.
 */
export function mesclarLimites(...camadas: ReadonlyArray<Limites>): Limites {
  const saida: Limites = {};
  for (const camada of camadas) {
    for (const chave of CHAVES_DE_LIMITE) {
      if (chave in camada) saida[chave] = camada[chave];
    }
  }
  return saida;
}

/** `undefined` = sem limite (ausente ou `null`). Nunca devolve `null` para a tela não ter dois "sem limite". */
export function tetoDe(limites: Limites, chave: ChaveDeLimite): number | undefined {
  const valor = limites[chave];
  return typeof valor === "number" ? valor : undefined;
}
