import { describe, expect, it } from "vitest";

import {
  agruparPorDia,
  diaLocal,
  diasDaGradeDoMes,
  horaLocal,
  instanteParaParede,
  limitesDoMes,
  mesmaHoraOutroDia,
  paredeParaInstante,
  rotuloDoDia,
} from "./tempo-da-tela";

const SP = "America/Sao_Paulo";

describe("tempo da tela — sempre no fuso da organização", () => {
  it("a parede digitada vira o instante certo no fuso, e volta igual", () => {
    expect(paredeParaInstante("2026-09-30T19:30", SP)).toBe("2026-09-30T22:30:00.000Z");
    expect(instanteParaParede("2026-09-30T22:30:00.000Z", SP)).toBe("2026-09-30T19:30");
    expect(horaLocal("2026-09-30T22:30:00.000Z", SP)).toBe("19:30");
    expect(paredeParaInstante("lixo", SP)).toBeNull();
  });

  it("o dia local muda à meia-noite de São Paulo, não de Greenwich", () => {
    expect(diaLocal("2026-10-01T02:30:00.000Z", SP)).toBe("2026-09-30");
    expect(diaLocal("2026-10-01T03:00:00.000Z", SP)).toBe("2026-10-01");
  });

  it("Amanhã no mesmo horário preserva a parede", () => {
    expect(mesmaHoraOutroDia("2026-09-30T22:30:00.000Z", 1, SP)).toBe("2026-10-01T22:30:00.000Z");
    expect(mesmaHoraOutroDia("2026-09-30T22:30:00.000Z", 2, SP)).toBe("2026-10-02T22:30:00.000Z");
  });

  it("rotuloDoDia: hoje, amanhã, ontem e data", () => {
    const agora = new Date("2026-09-30T15:00:00.000Z");
    expect(rotuloDoDia("2026-09-30T22:30:00.000Z", agora, SP).tipo).toBe("hoje");
    expect(rotuloDoDia("2026-10-01T22:30:00.000Z", agora, SP).tipo).toBe("amanha");
    expect(rotuloDoDia("2026-09-29T22:30:00.000Z", agora, SP).tipo).toBe("ontem");
    expect(rotuloDoDia("2026-10-05T22:30:00.000Z", agora, SP).tipo).toBe("data");
  });

  it("agruparPorDia mantém a ordem e junta o que cai no mesmo dia local", () => {
    const itens = [{ q: "2026-09-30T22:30:00.000Z" }, { q: "2026-10-01T02:00:00.000Z" }, { q: "2026-10-01T12:00:00.000Z" }];
    const g = agruparPorDia(itens, (i) => i.q, SP);
    expect(g.map((x) => [x.dia, x.itens.length])).toEqual([["2026-09-30", 2], ["2026-10-01", 1]]);
  });

  it("limitesDoMes cobre do primeiro 00:00 ao último 23:59:59 locais; a grade começa no domingo", () => {
    const { de, ate } = limitesDoMes(2026, 9, SP);
    expect(de).toBe("2026-09-01T03:00:00.000Z");
    expect(ate).toBe("2026-10-01T02:59:59.000Z");
    const grade = diasDaGradeDoMes(2026, 9); // 1º de setembro de 2026 é terça
    expect(grade.slice(0, 3)).toEqual([null, null, { dia: 1, chave: "2026-09-01" }]);
    expect(grade.length % 7).toBe(0);
    expect(grade.filter(Boolean)).toHaveLength(30);
  });
});
