import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  INTERVALO_DA_CONTAGEM_MS,
  TETO_DO_RECUO_DA_CONTAGEM_MS,
  intervaloDaContagem,
} from "@/hooks/inbox/useConversationCounts";

/**
 * O INBOX NÃO PODE MARTELAR UM BANCO QUE JÁ ESTÁ CAINDO.
 *
 * Produção, 03–04/11/2026: 515 timeouts na lista e 460 na contagem, em rajadas
 * de madrugada. Lista, contagem e rede de segurança repetiam no mesmo ritmo
 * com erro ou sem erro, e com a aba escondida ou não.
 */
describe("a contagem recua quando dá erro", () => {
  it("sem erro, o ritmo normal", () => {
    expect(intervaloDaContagem(0)).toBe(INTERVALO_DA_CONTAGEM_MS);
  });

  it("dobra a cada erro seguido e para no teto", () => {
    expect(intervaloDaContagem(1)).toBe(INTERVALO_DA_CONTAGEM_MS * 2);
    expect(intervaloDaContagem(2)).toBe(INTERVALO_DA_CONTAGEM_MS * 4);
    expect(intervaloDaContagem(50)).toBe(TETO_DO_RECUO_DA_CONTAGEM_MS);
  });
});

describe("a rede de segurança e o realtime da lista", () => {
  it("a rede de segurança não confere com a aba escondida e recua sob erro", () => {
    const fonte = readFileSync("hooks/realtime/useRefetchDeSeguranca.ts", "utf8");
    expect(fonte, "voltou a ser setInterval cego").not.toMatch(/setInterval\(/);
    expect(fonte).toMatch(/if \(document\.visibilityState === "visible"\) \{\s*const ok = await verificar\(\)/);
    expect(fonte).toMatch(/TETO_DO_RECUO_MS/);
  });

  it("o realtime da lista não invalida a cada evento", () => {
    const fonte = readFileSync("hooks/inbox/useConversationsRealtime.ts", "utf8");
    expect(fonte).toMatch(/JANELA_DO_REALTIME_MS/);
    expect(fonte).toMatch(/refetchType: "none"/);
  });
});
