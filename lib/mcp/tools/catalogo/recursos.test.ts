import { describe, expect, it } from "vitest";

import { RECURSOS } from "@/lib/entitlements/recursos";

import { TOOL_CATALOG } from "./index";
import { RECURSO_POR_TOOL, recursoDaTool } from "./recursos";

describe("catálogo MCP × recurso do plano", () => {
  it("toda tool do catálogo tem recurso declarado (Recurso ou null) — nunca undefined", () => {
    const semRecurso = TOOL_CATALOG.filter((t) => recursoDaTool(t.name) === undefined).map((t) => t.name);
    expect(semRecurso, "declare em RECURSO_POR_TOOL ou no domínio em DOMINIOS").toEqual([]);
  });

  it("toda exceção por tool aponta para tool que existe e recurso do vocabulário", () => {
    const nomes = new Set(TOOL_CATALOG.map((t) => t.name));
    for (const [tool, recurso] of Object.entries(RECURSO_POR_TOOL)) {
      expect(nomes.has(tool), `${tool} não existe no catálogo`).toBe(true);
      if (recurso !== null) expect((RECURSOS as readonly string[]).includes(recurso), tool).toBe(true);
    }
  });

  it("as decisões que a pasta não conta: etapas são CRM, LGPD e etiquetas são do produto", () => {
    expect(recursoDaTool("crm_create_stage")).toBe("crm");
    expect(recursoDaTool("crm_list_webhook_sources")).toBeNull();
    expect(recursoDaTool("crm_list_privacy_requests")).toBeNull();
    expect(recursoDaTool("crm_manage_tags")).toBeNull();
    expect(recursoDaTool("crm_list_at_risk_leads")).toBe("crm");
    expect(recursoDaTool("crm_schedule_followup")).toBe("ai_agents");
    expect(recursoDaTool("crm_move_lead_stage")).toBe("crm");
    expect(recursoDaTool("crm_send_whatsapp_message")).toBe("inbox");
    expect(recursoDaTool("tool_que_nao_existe")).toBeUndefined();
  });
});
