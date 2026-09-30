import { describe, expect, it } from "vitest";

import {
  ESPERA_ENTRE_TENTATIVAS_MS,
  MAXIMO_DE_TENTATIVAS,
  ocorrenciaPerdeuAJanela,
  ocorrenciaVenceu,
  proximaTentativaEm,
  TOLERANCIA_DE_ATRASO_MS,
} from "./politica";

const agora = new Date("2026-09-30T22:31:00.000Z");

describe("política de Publicações", () => {
  it("vencida = horário chegou; perdeu a janela = passou da tolerância (30 min)", () => {
    expect(ocorrenciaVenceu("2026-09-30T22:31:00.000Z", agora)).toBe(true);
    expect(ocorrenciaVenceu("2026-09-30T22:32:00.000Z", agora)).toBe(false);
    expect(TOLERANCIA_DE_ATRASO_MS).toBe(30 * 60 * 1000);
    expect(ocorrenciaPerdeuAJanela("2026-09-30T22:05:00.000Z", agora)).toBe(false);
    expect(ocorrenciaPerdeuAJanela("2026-09-30T22:00:59.000Z", agora)).toBe(true);
  });

  it("retry: 1 min, 5 min, 15 min; nada depois da última tentativa; Retry-After maior vence a tabela", () => {
    expect(MAXIMO_DE_TENTATIVAS).toBe(3);
    expect(proximaTentativaEm(1, agora)!.getTime() - agora.getTime()).toBe(ESPERA_ENTRE_TENTATIVAS_MS[0]);
    expect(proximaTentativaEm(2, agora)!.getTime() - agora.getTime()).toBe(ESPERA_ENTRE_TENTATIVAS_MS[1]);
    expect(proximaTentativaEm(3, agora)).toBeNull();
    expect(proximaTentativaEm(1, agora, 10 * 60_000)!.getTime() - agora.getTime()).toBe(10 * 60_000);
    expect(proximaTentativaEm(1, agora, 5_000)!.getTime() - agora.getTime()).toBe(ESPERA_ENTRE_TENTATIVAS_MS[0]);
  });
});
