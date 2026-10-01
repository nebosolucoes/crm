import { describe, expect, it } from "vitest";

import { cssRgb, luminancia, misturar, pontaDoDegrade } from "./degrade";

describe("pontaDoDegrade — o tom da beirada da tela", () => {
  it("cor escura (o marrom do encarte) clareia; cor clara (o creme) escurece — o degradê sempre aparece", () => {
    const marrom = [92, 42, 24] as const;
    const ponta = pontaDoDegrade(marrom);
    expect(luminancia(ponta)).toBeGreaterThan(luminancia(marrom) + 40);
    const creme = [248, 236, 188] as const;
    expect(luminancia(pontaDoDegrade(creme))).toBeLessThan(luminancia(creme) - 40);
  });

  it("mantém o matiz: o marrom vira um marrom mais claro, não cinza", () => {
    const [r, g, b] = pontaDoDegrade([92, 42, 24]);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("misturar e cssRgb", () => {
    expect(misturar([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
    expect(cssRgb([10.4, 20.6, 30])).toBe("rgb(10, 21, 30)");
  });
});
