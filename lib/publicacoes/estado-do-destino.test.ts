import { describe, expect, it } from "vitest";

import { estadoDoDestino, estadosDosDestinos, type ExecucaoParaEstado } from "./estado-do-destino";

const ex = (p: Partial<ExecucaoParaEstado>): ExecucaoParaEstado => ({ target_id: "t1", group_id: null, media_id: null, attempt: 1, status: "pending", retry_at: null, ...p });

describe("estadoDoDestino — o chip do Calendário por destino", () => {
  it("sem execução, segue a ocorrência", () => {
    expect(estadoDoDestino("pending", [])).toBe("programado");
    expect(estadoDoDestino("processing", [])).toBe("programado");
    expect(estadoDoDestino("done", [])).toBe("concluido");
    expect(estadoDoDestino("skipped", [])).toBe("falhou");
    expect(estadoDoDestino("cancelled", [])).toBe("cancelado");
  });

  it("todas as unidades enviadas = concluído; uma falha final = falhou", () => {
    expect(estadoDoDestino("done", [ex({ group_id: "g1", status: "sent" }), ex({ group_id: "g2", status: "sent" })])).toBe("concluido");
    expect(estadoDoDestino("partial", [ex({ group_id: "g1", status: "sent" }), ex({ group_id: "g2", status: "failed" })])).toBe("falhou");
  });

  it("vale a tentativa mais recente: a falha consertada pelo retry não pinta de vermelho", () => {
    expect(estadoDoDestino("done", [ex({ attempt: 1, status: "failed" }), ex({ attempt: 2, status: "sent" })])).toBe("concluido");
  });

  it("na fila, enviando ou com retry marcado = programado", () => {
    expect(estadoDoDestino("processing", [ex({ status: "sending" })])).toBe("programado");
    expect(estadoDoDestino("processing", [ex({ status: "failed", retry_at: "2030-01-01T00:00:00Z" })])).toBe("programado");
  });

  it("por destino: Instagram saiu e Facebook falhou na mesma data", () => {
    const r = estadosDosDestinos("partial", ["ig", "fb", "wa"], [ex({ target_id: "ig", status: "sent" }), ex({ target_id: "fb", status: "failed" })]);
    expect(r).toEqual({ ig: "concluido", fb: "falhou", wa: "falhou" });
  });
});
