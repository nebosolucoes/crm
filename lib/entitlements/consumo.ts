/**
 * Quanto a organização USA de cada limite — a régua ao lado do teto.
 *
 * Um teto sem medida é um número numa tela. Aqui mora a medida de cada chave
 * de `LIMITES`, sempre com o admin client e SEMPRE filtrando `organization_id`
 * (o chamador já resolveu a org de fonte confiável). O que conta como "uso":
 *
 *   max_channels             canais não arquivados (`channel_sessions.archived_at is null`)
 *   max_whatsapp/instagram/  canais de MENSAGEM não arquivados daquela rede
 *     messenger              (`channel_sessions.platform`; voz não conta)
 *
 * O TETO é o do plano/override MAIS os extras ativos da organização
 * (`organization_limit_extras`, 0281). Chave sem teto segue sem teto.
 *   max_users                vínculos ativos + convites pendentes (não aceitos, não
 *                            revogados, não vencidos) — o convite reserva a vaga,
 *                            senão o teto se fura convidando dez de uma vez
 *   max_ai_agents            agentes não arquivados
 *   broadcast_monthly_sends  execuções de disparo `sent` no mês corrente (UTC)
 *   max_contacts             contatos não anonimizados
 *
 * `limiteAtingido` é a pergunta das rotas de criação: `null` = pode criar
 * (sem teto, ou abaixo dele); senão `{ teto, uso }` para a recusa 409.
 * Falha da medida LANÇA — uma contagem que não voltou não pode virar "pode",
 * nem "não pode": é 500, como qualquer falha de banco.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import { PLATAFORMA_INSTAGRAM, PLATAFORMA_MESSENGER, PLATAFORMA_WHATSAPP } from "@/lib/channels/plataformas";

import { CHAVES_COM_EXTRA, CHAVES_DE_LIMITE, LIMITES, tetoDe, type ChaveDeLimite, type Limites } from "./limites";
import { entitlementsDaOrg } from "./resolver";

export interface Medicao {
  chave: ChaveDeLimite;
  /** `undefined` = sem teto. */
  teto: number | undefined;
  uso: number;
  /** Quanto dos extras vendidos à organização já está somado em `teto` (0 = nenhum). */
  extra: number;
  /** A chave BARRA a criação quando `uso >= teto` (etapa 8). */
  enforced: boolean;
  excedido: boolean;
}

/**
 * O mínimo de um builder do PostgREST que os medidores usam. Tipado à mão de
 * propósito: o tipo real (`PostgrestFilterBuilder<…>`) tem sete parâmetros e
 * fazia o compilador desistir ("instantiation excessively deep") — o que se
 * quer aqui é só encadear filtros e ler `count`/`error`.
 */
interface Filtro {
  eq(col: string, val: unknown): Filtro;
  in(col: string, vals: readonly unknown[]): Filtro;
  is(col: string, val: null): Filtro;
  gt(col: string, val: string): Filtro;
  gte(col: string, val: string): Filtro;
  then: PromiseLike<{ count: number | null; error: { message: string } | null }>["then"];
}

async function contar(admin: SupabaseClient, tabela: string, filtrar: (q: Filtro) => Filtro): Promise<number> {
  const base = admin.from(tabela).select("id", { count: "exact", head: true }) as unknown as Filtro;
  const { count, error } = await filtrar(base);
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return count ?? 0;
}

function inicioDoMesUtc(agora: Date): string {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
}

export const MEDIDORES: Record<ChaveDeLimite, (admin: SupabaseClient, orgId: string, agora: Date) => Promise<number>> = {
  max_channels: (admin, orgId) =>
    contar(admin, "channel_sessions", (q) => q.eq("organization_id", orgId).is("archived_at", null)),
  max_users: async (admin, orgId, agora) => {
    const [membros, convites] = await Promise.all([
      contar(admin, "user_organizations", (q) => q.eq("organization_id", orgId).is("revoked_at", null)),
      contar(admin, "team_invites", (q) =>
        q.eq("organization_id", orgId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", agora.toISOString()),
      ),
    ]);
    return membros + convites;
  },
  max_ai_agents: (admin, orgId) =>
    contar(admin, "ai_agents", (q) => q.eq("organization_id", orgId).is("archived_at", null)),
  broadcast_monthly_sends: (admin, orgId, agora) =>
    contar(admin, "scheduled_group_message_runs", (q) =>
      q.eq("organization_id", orgId).eq("status", "sent").gte("created_at", inicioDoMesUtc(agora)),
    ),
  max_contacts: (admin, orgId) =>
    contar(admin, "contacts", (q) => q.eq("organization_id", orgId).eq("is_anonymized", false)),
  // Só os ativos: desativar um setor devolve a vaga do plano.
  max_sectors: (admin, orgId) =>
    contar(admin, "sectors", (q) => q.eq("organization_id", orgId).eq("is_active", true)),
  max_whatsapp: (admin, orgId) => canaisDaRede(admin, orgId, PLATAFORMA_WHATSAPP),
  max_instagram: (admin, orgId) => canaisDaRede(admin, orgId, PLATAFORMA_INSTAGRAM),
  max_messenger: (admin, orgId) => canaisDaRede(admin, orgId, PLATAFORMA_MESSENGER),
};

/** Canais de mensagem, não arquivados, de uma rede. A linha de voz não é "um WhatsApp". */
function canaisDaRede(admin: SupabaseClient, orgId: string, rede: string): Promise<number> {
  return contar(admin, "channel_sessions", (q) =>
    q.eq("organization_id", orgId).is("archived_at", null).eq("platform", rede).in("provider", PROVIDERS_DE_MENSAGEM),
  );
}

/**
 * A soma dos extras ATIVOS por chave. Falha LANÇA, como a medida: um extra que
 * não foi lido não pode virar "sem extra" (recusaria quem pagou) nem "com
 * extra" (liberaria quem não pagou).
 */
export async function extrasDaOrg(admin: SupabaseClient, orgId: string): Promise<Partial<Record<ChaveDeLimite, number>>> {
  const { data, error } = await admin
    .from("organization_limit_extras")
    .select("limit_key, quantidade")
    .eq("organization_id", orgId)
    .is("revoked_at", null);
  if (error) throw new Error(`organization_limit_extras: ${error.message}`);
  const soma: Partial<Record<ChaveDeLimite, number>> = {};
  for (const linha of (data ?? []) as { limit_key: string; quantidade: number }[]) {
    if (!(CHAVES_COM_EXTRA as readonly string[]).includes(linha.limit_key)) continue;
    const chave = linha.limit_key as ChaveDeLimite;
    soma[chave] = (soma[chave] ?? 0) + linha.quantidade;
  }
  return soma;
}

/** Teto efetivo: o do plano/override + extras. Sem teto no plano = sem teto. */
function tetoComExtra(limites: Limites, chave: ChaveDeLimite, extras: Partial<Record<ChaveDeLimite, number>>) {
  const teto = tetoDe(limites, chave);
  const extra = extras[chave] ?? 0;
  return { teto: teto === undefined ? undefined : teto + extra, extra: teto === undefined ? 0 : extra };
}

/** Todas as chaves, medidas em paralelo — para a aba Plano do admin e a tela de Billing. */
export async function consumoDaOrg(
  admin: SupabaseClient,
  orgId: string,
  limits: Limites,
  agora: Date = new Date(),
): Promise<Medicao[]> {
  const extras = await extrasDaOrg(admin, orgId);
  return Promise.all(
    CHAVES_DE_LIMITE.map(async (chave) => {
      const { teto, extra } = tetoComExtra(limits, chave, extras);
      const uso = await MEDIDORES[chave](admin, orgId, agora);
      return { chave, teto, extra, uso, enforced: LIMITES[chave].enforced, excedido: teto !== undefined && uso >= teto };
    }),
  );
}

/**
 * A pergunta de uma rota de criação: já está no teto? `null` = pode. Só
 * pergunta a medida quando há teto — organização sem limite não paga a
 * contagem.
 */
export async function limiteAtingido(
  admin: SupabaseClient,
  orgId: string,
  chave: ChaveDeLimite,
  agora: Date = new Date(),
): Promise<{ teto: number; uso: number } | null> {
  const limites = (await entitlementsDaOrg(orgId)).limits;
  if (tetoDe(limites, chave) === undefined) return null;
  const { teto } = tetoComExtra(limites, chave, await extrasDaOrg(admin, orgId));
  if (teto === undefined) return null;
  const uso = await MEDIDORES[chave](admin, orgId, agora);
  return uso >= teto ? { teto, uso } : null;
}
