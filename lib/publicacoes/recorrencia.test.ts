import { describe, expect, it } from "vitest";

import { partesNoFuso } from "@/lib/agenda/fuso";

import { descreverRecorrencia, proximasOcorrencias } from "./recorrencia";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";

function parede(d: Date, fuso: string) {
  const p = partesNoFuso(d, fuso);
  return `${p.dia}/${p.mes} ${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

describe("proximasOcorrencias — a regra vira datas em hora de parede", () => {
  const base = new Date("2026-09-30T22:30:00.000Z"); // 19:30 em São Paulo (UTC-3)

  it("todo dia às 19:30 gera 19:30 todo dia, depois da base, até o horizonte", () => {
    const out = proximasOcorrencias({
      kind: "daily", config: {}, base, fuso: SP,
      apos: base, ate: new Date("2026-10-04T23:59:59.000Z"),
      jaExistentes: 1, limite: 100,
    });
    expect(out.map((d) => parede(d, SP))).toEqual(["1/10 19:30", "2/10 19:30", "3/10 19:30", "4/10 19:30"]);
  });

  it("não repete a base nem o que já foi materializado (`apos` é exclusivo)", () => {
    const out = proximasOcorrencias({
      kind: "daily", config: {}, base, fuso: SP,
      apos: new Date("2026-10-02T22:30:00.000Z"), ate: new Date("2026-10-04T23:59:59.000Z"),
      jaExistentes: 3, limite: 100,
    });
    expect(out.map((d) => parede(d, SP))).toEqual(["3/10 19:30", "4/10 19:30"]);
  });

  it("segura a hora de parede numa virada de horário de verão (Nova York, 1º de novembro)", () => {
    // 30/10/2026 19:30 em NY (EDT, UTC-4). Em 01/11 o relógio volta para EST (UTC-5).
    const baseNy = new Date("2026-10-30T23:30:00.000Z");
    const out = proximasOcorrencias({
      kind: "daily", config: {}, base: baseNy, fuso: NY,
      apos: baseNy, ate: new Date("2026-11-04T12:00:00.000Z"), // 3/11 19:30 EST = 04/11 00:30Z
      jaExistentes: 1, limite: 10,
    });
    expect(out.map((d) => parede(d, NY))).toEqual(["31/10 19:30", "1/11 19:30", "2/11 19:30", "3/11 19:30"]);
    // Em UTC a distância entre 31/10 e 01/11 é 25 h — a parede é o que se preserva.
    expect(out[1]!.getTime() - out[0]!.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it("mensal trava no último dia do mês e volta ao dia âncora quando ele existe", () => {
    const b = new Date("2026-01-31T15:00:00.000Z"); // 31/01 12:00 SP
    const out = proximasOcorrencias({
      kind: "monthly", config: {}, base: b, fuso: SP,
      apos: b, ate: new Date("2026-05-31T23:59:59.000Z"),
      jaExistentes: 1, limite: 10,
    });
    expect(out.map((d) => parede(d, SP))).toEqual(["28/2 12:00", "31/3 12:00", "30/4 12:00", "31/5 12:00"]);
  });

  it("weekdays gera só os dias escolhidos (seg, qua, sex), no fuso da publicação", () => {
    // 30/09/2026 é quarta-feira.
    const out = proximasOcorrencias({
      kind: "weekdays", config: { weekdays: [1, 3, 5] }, base, fuso: SP,
      apos: base, ate: new Date("2026-10-10T23:59:59.000Z"),
      jaExistentes: 1, limite: 100,
    });
    expect(out.map((d) => parede(d, SP))).toEqual(["2/10 19:30", "5/10 19:30", "7/10 19:30", "9/10 19:30"]);
  });

  it("weekly com intervalo 2 pula uma semana", () => {
    const out = proximasOcorrencias({
      kind: "weekly", config: { interval: 2 }, base, fuso: SP,
      apos: base, ate: new Date("2026-11-30T23:59:59.000Z"),
      jaExistentes: 1, limite: 3,
    });
    expect(out.map((d) => parede(d, SP))).toEqual(["14/10 19:30", "28/10 19:30", "11/11 19:30"]);
  });

  it("respeita repeat_until e max_occurrences (contando as que já existem)", () => {
    const ate = proximasOcorrencias({
      kind: "daily", config: {}, base, fuso: SP,
      apos: base, ate: new Date("2026-12-31T00:00:00.000Z"),
      repeatUntil: new Date("2026-10-02T23:00:00.000Z"),
      jaExistentes: 1, limite: 100,
    });
    expect(ate.map((d) => parede(d, SP))).toEqual(["1/10 19:30", "2/10 19:30"]);

    const max = proximasOcorrencias({
      kind: "daily", config: {}, base, fuso: SP,
      apos: base, ate: new Date("2026-12-31T00:00:00.000Z"),
      maxOccurrences: 3, jaExistentes: 1, limite: 100,
    });
    expect(max).toHaveLength(2);
  });

  it("custom em minutos é passo fixo de tempo e salta direto para depois de `apos`", () => {
    const out = proximasOcorrencias({
      kind: "custom", config: { interval_minutes: 90 }, base, fuso: SP,
      apos: new Date(base.getTime() + 10 * 60 * 60 * 1000), ate: new Date(base.getTime() + 14 * 60 * 60 * 1000),
      jaExistentes: 1, limite: 100,
    });
    // 90 min × 7 = 10,5 h (primeiro depois de +10 h), depois +12 h e +13,5 h.
    expect(out.map((d) => (d.getTime() - base.getTime()) / 60_000)).toEqual([630, 720, 810]);
  });

  it("`none` e base inválida devolvem vazio", () => {
    expect(proximasOcorrencias({ kind: "none", config: {}, base, fuso: SP, apos: base, ate: base, jaExistentes: 0, limite: 10 })).toEqual([]);
    expect(proximasOcorrencias({ kind: "daily", config: {}, base: new Date("x"), fuso: SP, apos: base, ate: base, jaExistentes: 0, limite: 10 })).toEqual([]);
  });
});

describe("descreverRecorrencia", () => {
  it("fala a língua da tela", () => {
    expect(descreverRecorrencia("none", {})).toBeNull();
    expect(descreverRecorrencia("daily", {})).toBe("Todo dia");
    expect(descreverRecorrencia("daily", { interval: 3 })).toBe("A cada 3 dias");
    expect(descreverRecorrencia("weekdays", { weekdays: [5, 1, 3] })).toBe("seg, qua, sex");
    expect(descreverRecorrencia("custom", { interval_minutes: 30 })).toBe("A cada 30 min");
  });
});
