import { describe, expect, it } from "vitest";

import { carrosselCorta, feedCorta, proporcaoDoFeed } from "./proporcao";

describe("proporcaoDoFeed — o quadro do Feed segue a mídia dentro do limite da rede", () => {
  it("Instagram: 4:5 a 1.91:1 — dentro segue a foto, fora corta no limite", () => {
    expect(proporcaoDoFeed("instagram", 1080, 1080)).toBe(1);
    expect(proporcaoDoFeed("instagram", 1080, 1350)).toBeCloseTo(0.8, 5);
    expect(proporcaoDoFeed("instagram", 1080, 1920)).toBeCloseTo(0.8, 5); // 9:16 vira 4:5
    expect(proporcaoDoFeed("instagram", 1920, 1080)).toBeCloseTo(16 / 9, 5);
    expect(proporcaoDoFeed("instagram", 3000, 1000)).toBeCloseTo(1.91, 5);
    expect(feedCorta("instagram", 1080, 1920)).toBe(true);
    expect(feedCorta("instagram", 1080, 1350)).toBe(false);
  });

  it("Facebook: uma foto sozinha aparece inteira até 1:2", () => {
    expect(proporcaoDoFeed("facebook", 1080, 1920)).toBeCloseTo(9 / 16, 5);
    expect(feedCorta("facebook", 1080, 1920)).toBe(false);
    expect(proporcaoDoFeed("facebook", 1000, 3000)).toBeCloseTo(0.5, 5);
  });

  it("sem dimensão conhecida assume quadrado e não acusa corte", () => {
    expect(proporcaoDoFeed("instagram", null, null)).toBe(1);
    expect(proporcaoDoFeed("instagram", 0, 100)).toBe(1);
    expect(feedCorta("instagram", null, 100)).toBe(false);
  });
});

describe("carrosselCorta — no Instagram o carrossel inteiro sai no quadro da primeira", () => {
  it("4:5 seguida de 16:9 corta a segunda; duas 4:5 não cortam; uma só nunca corta", () => {
    expect(carrosselCorta("instagram", [{ width: 1080, height: 1350 }, { width: 1920, height: 1080 }])).toBe(true);
    expect(carrosselCorta("instagram", [{ width: 1080, height: 1350 }, { width: 540, height: 675 }])).toBe(false);
    expect(carrosselCorta("instagram", [{ width: 1080, height: 1350 }])).toBe(false);
  });
  it("Facebook faz grade, não carrossel — nunca acusa", () => {
    expect(carrosselCorta("facebook", [{ width: 1080, height: 1350 }, { width: 1920, height: 1080 }])).toBe(false);
  });
});
