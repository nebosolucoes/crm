import { describe, expect, it } from "vitest";

import { RECURSOS } from "@/lib/entitlements/recursos";

import { RECURSO_POR_ACAO, recursoDaAcao } from "./recurso-por-acao";
import "./actions/register-all";
import { getAction } from "./actions";

describe("ações de automação × recurso do plano", () => {
  it("toda ação registrada no motor tem recurso declarado (Recurso ou null)", () => {
    const semRecurso = Object.keys(RECURSO_POR_ACAO).length === 0 ? ["mapa vazio"] : [];
    for (const type of ["add_tag", "assign_owner", "call_webhook", "create_or_move_lead", "send_ai_message", "send_whatsapp_message", "start_message_flow"]) {
      expect(getAction(type), `${type} não está registrado — a lista deste teste envelheceu`).toBeTruthy();
      if (recursoDaAcao(type) === undefined) semRecurso.push(type);
    }
    expect(semRecurso).toEqual([]);
  });

  it("todo recurso do mapa existe no vocabulário; as decisões que a pasta não conta", () => {
    for (const r of Object.values(RECURSO_POR_ACAO)) {
      if (r !== null) expect((RECURSOS as readonly string[]).includes(r)).toBe(true);
    }
    expect(recursoDaAcao("send_ai_message")).toBe("ai_agents");
    expect(recursoDaAcao("create_or_move_lead")).toBe("crm");
    expect(recursoDaAcao("call_webhook")).toBeNull();
    expect(recursoDaAcao("inventada")).toBeUndefined();
  });
});
