/** Apresentação por vínculo. Nunca é autorização de página, API ou ação. */
import { z } from "zod";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { recursoDoDestino } from "@/lib/entitlements/recursos";
import { temRecurso, type EntitlementsSerializados } from "@/lib/entitlements/tipos";
import { NAV_CATALOG, type NavMetadata, type NavDestinationId } from "./catalogo";

/**
 * O segundo eixo da visibilidade: além do papel da PESSOA, o que a ORGANIZAÇÃO
 * pode usar (plano + overrides, resolvido pelo banco — `ActiveOrg.entitlements`).
 *
 * `undefined` = NÃO filtra. É deliberado, e não um default frouxo: os
 * consumidores que não passam entitlements são os que falam do PRESET, não do
 * plano — o editor de interface (`InterfaceEditor`), a validação do convite
 * (`interfaceTemDestino`), o formulário de tenant novo. Um preset que inclua
 * CRM continua válido numa organização que hoje não tem CRM: o plano pode
 * mudar amanhã e o preset não deveria precisar ser refeito. Quem DESENHA para
 * a pessoa (Sidebar, hub, ⌘K, home, sino) passa `activeOrg.entitlements`.
 *
 * `null` (entitlements ainda não carregados, ou organização sem eles) filtra
 * FECHADO para o vendável: `temRecurso(null, …)` só libera `channels`.
 */
export type Entitlements = EntitlementsSerializados | null | undefined;
export function orgPodeVer(d: Pick<NavMetadata, "href">, entitlements: Entitlements): boolean {
  if (entitlements === undefined) return true;
  const recurso = recursoDoDestino(d.href);
  // `null` = destino do produto (Organização, exceções); `undefined` não
  // acontece para href do catálogo — e se acontecer, não é motivo para esconder.
  if (recurso === null || recurso === undefined) return true;
  return temRecurso(entitlements, recurso);
}

const ids = NAV_CATALOG.map((d) => d.href);
export const interfaceSettingsSchema = z
  .object({
    preset: z.enum(["completa", "simplificada"]),
    destinos: z
      .array(z.enum(ids as [NavDestinationId, ...NavDestinationId[]]))
      .min(1)
      .max(ids.length)
      .transform((values) => ids.filter((id) => values.includes(id)))
      .optional(),
  })
  .strict();
export type InterfaceSettings = z.infer<typeof interfaceSettingsSchema>;
export const INTERFACE_COMPLETA: InterfaceSettings = { preset: "completa" };
const SIMPLIFICADA: readonly NavDestinationId[] = [
  "/app/inbox",
  "/app/agenda",
  "/app/publicacoes/lista",
  "/app/publicacoes/agendar",
  "/app/publicacoes/calendario",
  "/app/publicacoes/grupos",
  "/app/publicacoes/historico",
  "/app/kanban",
  "/app/contacts",
  "/app/tasks",
  "/app/connections",
];
/** Portas pessoais e recuperação administrativa não são removíveis. Atualização
 * e administração de plataforma têm consumidores próprios com seus gates atuais. */
export const PORTAS_ESSENCIAIS = [
  "/app/settings/profile",
  "/app/settings/security",
  "/app/team",
] as const;
export function essencial(d: NavMetadata, role: Role | null, platform = false): boolean {
  return (
    d.href === PORTAS_ESSENCIAIS[0] ||
    d.href === PORTAS_ESSENCIAIS[1] ||
    (d.href === PORTAS_ESSENCIAIS[2] && (platform || role === "admin"))
  );
}
export function canSee(
  d: Pick<NavMetadata, "href" | "minRole">,
  platform: boolean,
  role: Role | null,
  entitlements?: Entitlements,
): boolean {
  // O platform admin bypassa o PAPEL, nunca o plano: entitlement é da
  // organização, e quem a acompanha vê o que ela vê.
  if (!orgPodeVer(d, entitlements)) return false;
  return platform || (!!role && ROLE_RANK[role] >= ROLE_RANK[d.minRole ?? "viewer"]);
}
export function permitidos(
  platform: boolean,
  role: Role | null,
  entitlements?: Entitlements,
): NavMetadata[] {
  return NAV_CATALOG.filter((d) => canSee(d, platform, role, entitlements));
}
/** Leitura tolera versões antigas/removidas sem lançar no layout. */
export function lerInterface(raw: unknown): {
  settings: InterfaceSettings;
  needsAdjustment: boolean;
} {
  if (raw == null) return { settings: INTERFACE_COMPLETA, needsAdjustment: false };
  if (typeof raw !== "object") return { settings: INTERFACE_COMPLETA, needsAdjustment: true };
  const value = raw as Record<string, unknown>;
  const destinos = Array.isArray(value.destinos)
    ? ids.filter((id) => (value.destinos as unknown[]).includes(id))
    : undefined;
  const parsed = interfaceSettingsSchema.safeParse({
    preset: value.preset,
    ...(destinos ? { destinos } : {}),
  });
  if (!parsed.success) return { settings: INTERFACE_COMPLETA, needsAdjustment: true };
  return {
    settings: parsed.data,
    needsAdjustment: !!destinos && destinos.length !== (value.destinos as unknown[]).length,
  };
}
export function destinosDaInterface(
  raw: unknown,
  platform: boolean,
  role: Role | null,
  entitlements?: Entitlements,
): NavMetadata[] {
  const { settings } = lerInterface(raw);
  const allowed = permitidos(platform, role, entitlements);
  const chosen =
    settings.destinos ?? (settings.preset === "simplificada" ? SIMPLIFICADA : undefined);
  return allowed.filter(
    (d) => essencial(d, role, platform) || !chosen || chosen.includes(d.href as NavDestinationId),
  );
}
export function interfaceTemDestino(
  settings: InterfaceSettings,
  role: Role,
  platform = false,
): boolean {
  return destinosDaInterface(settings, platform, role).some((d) => !essencial(d, role, platform));
}
export function homeDaInterface(
  raw: unknown,
  platform: boolean,
  role: Role | null,
  entitlements?: Entitlements,
): string {
  const visible = destinosDaInterface(raw, platform, role, entitlements);
  return (
    visible.find((d) => d.href === "/app/inbox")?.href ??
    visible.find((d) => !essencial(d, role, platform))?.href ??
    "/app/settings/profile"
  );
}
