import { describe, expect, it } from "vitest";

import { NAV_CATALOG, NAV_GROUPS } from "@/lib/navigation/catalogo";

import {
  DESCRICAO_DO_RECURSO,
  DESTINOS_SEM_RECURSO,
  GRUPO_PARA_RECURSO,
  RECURSOS,
  RECURSOS_SEMPRE_LIGADOS,
  RECURSOS_VENDAVEIS,
  ROTULO_DO_RECURSO,
  ehRecurso,
  ehRecursoVendavel,
  recursoDoDestino,
  sempreLigado,
} from "./recursos";

describe("vocabulário de recursos", () => {
  it("vendáveis = todos menos os sempre ligados (nenhum vendável é lei, nenhuma lei é vendável)", () => {
    const vendaveis = new Set<string>(RECURSOS_VENDAVEIS);
    const lei = new Set<string>(RECURSOS_SEMPRE_LIGADOS);
    for (const r of RECURSOS) {
      expect(vendaveis.has(r) !== lei.has(r), `${r} tem que estar em exatamente uma das listas`).toBe(true);
    }
    expect(vendaveis.size + lei.size).toBe(RECURSOS.length);
  });

  it("channels é lei e não é vendável", () => {
    expect(sempreLigado("channels")).toBe(true);
    expect(ehRecursoVendavel("channels")).toBe(false);
    expect(ehRecurso("channels")).toBe(true);
  });

  it("os cinco vendáveis não são lei", () => {
    for (const r of RECURSOS_VENDAVEIS) expect(sempreLigado(r), r).toBe(false);
  });

  it("guardas de tipo recusam o que não está na lista", () => {
    expect(ehRecurso("plano")).toBe(false);
    expect(ehRecurso(null)).toBe(false);
    expect(ehRecurso(42)).toBe(false);
    expect(ehRecursoVendavel("CRM")).toBe(false); // case-sensitive: é o valor do CHECK
  });

  it("todo recurso tem rótulo e descrição não vazios", () => {
    for (const r of RECURSOS) {
      expect(ROTULO_DO_RECURSO[r].trim().length, r).toBeGreaterThan(0);
      expect(DESCRICAO_DO_RECURSO[r].trim().length, r).toBeGreaterThan(0);
    }
  });
});

describe("grupo da navegação → recurso", () => {
  it("todo grupo do catálogo tem uma decisão (o Record é exaustivo, o teste é a prova em runtime)", () => {
    for (const g of NAV_GROUPS) {
      expect(g.id in GRUPO_PARA_RECURSO, `grupo ${g.id} sem linha em GRUPO_PARA_RECURSO`).toBe(true);
    }
  });

  it("os seis grupos vendáveis apontam para recursos distintos; Organização não é vendável", () => {
    const apontados = Object.entries(GRUPO_PARA_RECURSO)
      .filter(([, r]) => r !== null)
      .map(([, r]) => r);
    expect(new Set(apontados).size).toBe(apontados.length);
    expect(GRUPO_PARA_RECURSO.organizacao).toBeNull();
    expect(GRUPO_PARA_RECURSO.canais).toBe("channels");
  });

  it("todo recurso é alcançável por algum grupo — recurso sem tela seria um gate sem porta", () => {
    const alcancados = new Set(Object.values(GRUPO_PARA_RECURSO));
    for (const r of RECURSOS) expect(alcancados.has(r), `${r} não governa grupo nenhum`).toBe(true);
  });

  it("toda exceção declarada em DESTINOS_SEM_RECURSO existe no catálogo", () => {
    const hrefs = new Set<string>(NAV_CATALOG.map((d) => d.href));
    for (const href of DESTINOS_SEM_RECURSO) expect(hrefs.has(href), href).toBe(true);
  });
});

describe("recursoDoDestino", () => {
  it("destino exato do catálogo devolve o recurso do grupo", () => {
    expect(recursoDoDestino("/app/kanban")).toBe("crm");
    expect(recursoDoDestino("/app/publicacoes/lista")).toBe("broadcast");
    expect(recursoDoDestino("/app/ai/agents")).toBe("ai_agents");
    expect(recursoDoDestino("/app/metrics")).toBe("analytics");
    expect(recursoDoDestino("/app/inbox")).toBe("inbox");
    expect(recursoDoDestino("/app/connections")).toBe("channels");
  });

  it("subrota herda do destino (prefixo com fronteira de segmento)", () => {
    expect(recursoDoDestino("/app/kanban/abc")).toBe("crm");
    expect(recursoDoDestino("/app/ai/agents/123/")).toBe("ai_agents");
    expect(recursoDoDestino("/app/inbox/conv-1")).toBe("inbox");
  });

  it("o prefixo mais longo vence: Etapas do funil é CRM, não Organização", () => {
    expect(recursoDoDestino("/app/settings/tenant/pipelines")).toBe("crm");
    expect(recursoDoDestino("/app/settings/tenant")).toBeNull();
    expect(recursoDoDestino("/app/settings/profile")).toBeNull();
  });

  it("Organização e as exceções devolvem null (do produto, nunca gateadas)", () => {
    expect(recursoDoDestino("/app/team")).toBeNull();
    expect(recursoDoDestino("/app/audit")).toBeNull();
    expect(recursoDoDestino("/app/audit/qualquer")).toBeNull();
    // A Central é exceção; o resto do grupo IA continua gateado.
    expect(recursoDoDestino("/app/ai/inbox")).toBeNull();
    expect(recursoDoDestino("/app/ai/agents")).toBe("ai_agents");
  });

  it("URL fora do catálogo devolve undefined — nunca null, para a cerca não ler como liberado", () => {
    expect(recursoDoDestino("/app/nao-existe")).toBeUndefined();
    expect(recursoDoDestino("/app/aiX")).toBeUndefined();
    expect(recursoDoDestino("/app")).toBeUndefined();
  });
});
