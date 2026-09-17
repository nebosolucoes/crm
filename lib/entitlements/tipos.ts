/**
 * A forma de um ENTITLEMENT já resolvido — o que a organização pode usar, agora.
 *
 * Quem resolve é o banco (`fn_org_entitlements`, migration 0267): plano
 * atribuído (ou o padrão), mais os overrides ativos, menos os `disable`, mais
 * `channels` sempre. Este arquivo NÃO reimplementa essa regra — duas
 * implementações divergiriam na primeira mudança. Ele só dá FORMA ao jsonb que
 * a função devolve (`lerEntitlements`) e responde a pergunta que todo consumidor
 * faz (`temRecurso`).
 *
 * Client-safe: o layout de `/app` resolve uma vez e passa
 * `EntitlementsSerializados` ao `AuthProvider`; o Sidebar e `useRecurso()` leem
 * de lá. `Set` não atravessa a fronteira servidor→navegador, por isso a forma
 * serializada usa array.
 */
import { lerLimites, type Limites } from "./limites";
import { RECURSOS_SEMPRE_LIGADOS, ehRecurso, sempreLigado, type Recurso } from "./recursos";

export interface PlanoResolvido {
  id: string;
  slug: string;
  name: string;
  /** Plano inativo não pode ser ATRIBUÍDO; quem já está nele continua. A tela avisa. */
  is_active: boolean;
}

export const MODOS_DE_OVERRIDE = ["enable", "disable"] as const;
export type ModoDeOverride = (typeof MODOS_DE_OVERRIDE)[number];

/** Um override que está VALENDO agora (janela aberta, não revogado). Os vencidos não vêm. */
export interface OverrideAtivo {
  id: string;
  feature: Recurso;
  mode: ModoDeOverride;
  /** ISO-8601. `ends_at` nulo = até alguém revogar. */
  starts_at: string;
  ends_at: string | null;
  limits: Limites;
  reason: string;
}

/**
 * De onde veio o plano da resposta:
 *   `atribuido` → `organizations.plan_id`;
 *   `padrao`    → a organização não tinha plano e caiu no `is_default`;
 *   `nenhum`    → nem plano nem padrão — só `channels`. Estado que a tela do
 *                 admin pinta de vermelho: é alcançável apenas apagando o plano
 *                 padrão à mão, e precisa ser visto, não deduzido.
 *   `sem_schema`→ o banco ainda não tem `fn_org_entitlements` (a 0275 não foi
 *                 aplicada). Só `resolver.ts` produz isto, e responde como o
 *                 legado — tudo ligado — para o produto se comportar como a
 *                 versão anterior em vez de dar 500. Ver o porquê lá.
 */
export type OrigemDoPlano = "atribuido" | "padrao" | "nenhum" | "sem_schema";

export interface EntitlementsSerializados {
  plan: PlanoResolvido | null;
  origem: OrigemDoPlano;
  features: Recurso[];
  limits: Limites;
  overrides: OverrideAtivo[];
}

export interface Entitlements extends Omit<EntitlementsSerializados, "features"> {
  features: ReadonlySet<Recurso>;
}

/**
 * Leitura TOLERANTE do jsonb da função — nunca lança. Feature que este código
 * não conhece é descartada (uma versão mais nova do banco não pode derrubar o
 * layout da versão velha do app); `channels` entra sempre, mesmo que o jsonb
 * venha vazio ou torto — é a camada 1 das três do cabeçalho de `recursos.ts`.
 *
 * O que NÃO é tolerado: `raw` sem forma alguma (não-objeto) vira o entitlement
 * MÍNIMO (`origem: "nenhum"`, só `channels`) — fechado, e observável pela
 * origem. Quem quiser falhar alto diante de um erro de RPC faz isso ANTES de
 * chamar aqui (é o que `resolver.ts` faz): esta função dá forma a uma resposta,
 * não decide se houve resposta.
 */
export function lerEntitlements(raw: unknown): Entitlements {
  const obj = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const features = new Set<Recurso>(RECURSOS_SEMPRE_LIGADOS);
  if (Array.isArray(obj.features)) {
    for (const f of obj.features) if (ehRecurso(f)) features.add(f);
  }

  const overrides: OverrideAtivo[] = [];
  if (Array.isArray(obj.overrides)) {
    for (const o of obj.overrides) {
      const lido = lerOverride(o);
      if (lido) overrides.push(lido);
    }
  }

  return {
    plan: lerPlano(obj.plan),
    origem: lerOrigem(obj.origem, obj.plan),
    features,
    limits: lerLimites(obj.limits),
    overrides,
  };
}

function lerPlano(raw: unknown): PlanoResolvido | null {
  if (raw === null || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.slug !== "string" || typeof p.name !== "string") return null;
  return { id: p.id, slug: p.slug, name: p.name, is_active: p.is_active !== false };
}

function lerOrigem(raw: unknown, plano: unknown): OrigemDoPlano {
  if (raw === "atribuido" || raw === "padrao" || raw === "nenhum" || raw === "sem_schema") return raw;
  // Jsonb antigo sem `origem`: se veio plano, o mais provável é atribuído; sem
  // plano, é "nenhum". Nunca inventa "padrao" — seria afirmar uma queda no
  // padrão que não se mediu.
  return plano ? "atribuido" : "nenhum";
}

function lerOverride(raw: unknown): OverrideAtivo | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ehRecurso(o.feature)) return null;
  if (o.mode !== "enable" && o.mode !== "disable") return null;
  if (typeof o.starts_at !== "string") return null;
  // A camada 3 (CHECK do banco) já recusa isto; aqui é a camada 1 se recusando
  // a acreditar num jsonb que diga o contrário.
  if (o.feature === "channels" && o.mode === "disable") return null;
  return {
    id: o.id,
    feature: o.feature,
    mode: o.mode,
    starts_at: o.starts_at,
    ends_at: typeof o.ends_at === "string" ? o.ends_at : null,
    limits: lerLimites(o.limits),
    reason: typeof o.reason === "string" ? o.reason : "",
  };
}

/**
 * A pergunta. Aceita as duas formas (servidor e navegador) e também "ainda não
 * carregado" (`null`/`undefined`), que responde FECHADO para o que é vendável e
 * ABERTO para o que é lei — um Sidebar que renderiza antes de o contexto chegar
 * não pode nem esconder Canais nem mostrar CRM por engano.
 */
export function temRecurso(
  entitlements: Entitlements | EntitlementsSerializados | null | undefined,
  recurso: Recurso,
): boolean {
  if (sempreLigado(recurso)) return true;
  if (!entitlements) return false;
  const f = entitlements.features;
  return f instanceof Set ? f.has(recurso) : (f as readonly Recurso[]).includes(recurso);
}

export function serializarEntitlements(e: Entitlements): EntitlementsSerializados {
  return { ...e, features: Array.from(e.features) };
}

/** Os overrides que valem para UM recurso — a tela de plano mostra "IA liberada até dd/mm" a partir daqui. */
export function overridesDoRecurso(
  e: Entitlements | EntitlementsSerializados,
  recurso: Recurso,
): OverrideAtivo[] {
  return e.overrides.filter((o) => o.feature === recurso);
}
