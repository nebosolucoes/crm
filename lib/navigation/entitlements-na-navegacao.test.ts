/**
 * O segundo eixo da navegação: além do papel, o que a ORGANIZAÇÃO pode usar.
 *
 * O que se prova aqui é que Sidebar, hub, ⌘K e home são PROJEÇÕES do mesmo
 * filtro — e que o filtro só age quando recebe entitlements. `undefined` (os
 * consumidores do preset) continua vendo tudo; `null` (contexto ainda não
 * carregado) fecha o vendável e nunca esconde Canais.
 */
import { describe, expect, it } from "vitest";

import { NAV_GROUPS } from "./catalogo";
import { canSee, destinosDaInterface, homeDaInterface, orgPodeVer } from "./interface";
import { hubSections, searchable, sidebarGroups } from "./registry";
import type { EntitlementsSerializados } from "@/lib/entitlements/tipos";

function ent(features: EntitlementsSerializados["features"]): EntitlementsSerializados {
  return { plan: null, origem: "atribuido", features, limits: {}, overrides: [] };
}
const STARTER = ent(["channels", "inbox"]);
const TUDO = ent(["channels", "inbox", "broadcast", "crm", "ai_agents", "analytics"]);

describe("orgPodeVer / canSee", () => {
  it("undefined não filtra; null fecha o vendável e abre Canais", () => {
    expect(orgPodeVer({ href: "/app/kanban" }, undefined)).toBe(true);
    expect(orgPodeVer({ href: "/app/kanban" }, null)).toBe(false);
    expect(orgPodeVer({ href: "/app/connections" }, null)).toBe(true);
    expect(orgPodeVer({ href: "/app/settings/profile" }, null)).toBe(true);
  });

  it("platform admin bypassa o papel, nunca o plano", () => {
    expect(canSee({ href: "/app/ai/agents", minRole: "manager" }, true, null, STARTER)).toBe(false);
    expect(canSee({ href: "/app/ai/agents", minRole: "manager" }, true, null, TUDO)).toBe(true);
    expect(canSee({ href: "/app/ai/agents", minRole: "manager" }, true, null)).toBe(true);
  });

  it("as exceções seguem visíveis sem o recurso do grupo: Audit Log e a Central", () => {
    expect(orgPodeVer({ href: "/app/audit" }, STARTER)).toBe(true);
    expect(orgPodeVer({ href: "/app/ai/inbox" }, STARTER)).toBe(true);
    expect(orgPodeVer({ href: "/app/metrics" }, STARTER)).toBe(false);
    expect(orgPodeVer({ href: "/app/ai/agents" }, STARTER)).toBe(false);
  });
});

describe("as projeções", () => {
  it("Sidebar: Starter perde os grupos Disparo, CRM, IA e Análise INTEIROS — inclusive IA, apesar da Central", () => {
    const grupos = sidebarGroups(false, "admin", undefined, STARTER).map((g) => g.group.id);
    expect(grupos).toEqual(["atendimento", "canais", "organizacao"]);
  });

  it("Sidebar: com tudo, todos os grupos com destino no menu aparecem", () => {
    const grupos = sidebarGroups(false, "admin", undefined, TUDO).map((g) => g.group.id);
    expect(grupos).toEqual(NAV_GROUPS.map((g) => g.id));
  });

  it("Sidebar sem entitlements (undefined) é o de antes — nenhum grupo some por plano", () => {
    expect(sidebarGroups(false, "admin", undefined).length).toBe(sidebarGroups(false, "admin", undefined, TUDO).length);
  });

  it("⌘K: a Central e o Audit Log seguem buscáveis no Starter; o resto dos grupos deles não", () => {
    const hrefs = searchable(false, "admin", undefined, STARTER).map((d) => d.href);
    expect(hrefs).toContain("/app/ai/inbox");
    expect(hrefs).toContain("/app/audit");
    expect(hrefs).toContain("/app/inbox");
    expect(hrefs).toContain("/app/connections");
    expect(hrefs).not.toContain("/app/ai/agents");
    expect(hrefs).not.toContain("/app/kanban");
    expect(hrefs).not.toContain("/app/metrics");
    expect(hrefs).not.toContain("/app/disparo/lista");
  });

  it("hub do CRM fica vazio no Starter e cheio com tudo", () => {
    expect(hubSections("crm", false, "admin", undefined, STARTER)).toEqual([]);
    expect(hubSections("crm", false, "admin", undefined, TUDO).length).toBeGreaterThan(0);
  });

  it("home: sem Atendimento cai no primeiro destino que a organização TEM, não em /app/inbox", () => {
    expect(homeDaInterface(undefined, false, "admin", ent(["channels", "crm"]))).toBe("/app/kanban");
    expect(homeDaInterface(undefined, false, "admin", STARTER)).toBe("/app/inbox");
    // Só Canais: a home é o primeiro destino visível que a organização TEM —
    // e nunca o Inbox, que ela não tem.
    const soCanais = homeDaInterface(undefined, false, "admin", ent(["channels"]));
    expect(soCanais).not.toBe("/app/inbox");
    expect(orgPodeVer({ href: soCanais }, ent(["channels"]))).toBe(true);
  });

  it("destinosDaInterface respeita o preset E o plano ao mesmo tempo", () => {
    const so = destinosDaInterface({ preset: "simplificada" }, false, "admin", STARTER).map((d) => d.href);
    expect(so).toContain("/app/inbox");
    expect(so).not.toContain("/app/kanban"); // no preset, mas fora do plano
    expect(so).not.toContain("/app/ai/inbox"); // no plano (exceção), mas fora do preset
  });
});
