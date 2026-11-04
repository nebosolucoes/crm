import { describe, expect, it } from "vitest";

import { primeiraFalhaDaContagem } from "@/app/api/v1/conversations/counts/route";

/**
 * O 500 de `GET /api/v1/conversations/counts` chegava ao registro de erros SEM
 * mensagem (ID 67c73e41…, 30/10/2026): a contagem é HEAD, HEAD não tem corpo, e
 * o `postgrest-js` monta o erro com `message: ""`. Estes casos provam que o
 * motivo nunca mais sai vazio.
 */
const ok = { error: null, status: 200, statusText: "OK" };

describe("primeiraFalhaDaContagem", () => {
  it("sem falha devolve null", () => {
    expect(primeiraFalhaDaContagem({ fila: ok, all: ok })).toBeNull();
  });

  it("erro vazio de HEAD vira mensagem com a contagem e o status HTTP", () => {
    const falha = primeiraFalhaDaContagem({
      fila: ok,
      mine: { error: { message: "" }, status: 500, statusText: "Internal Server Error" },
    });
    expect(falha).not.toBeNull();
    expect(falha!.message).toContain('Contagem "mine"');
    expect(falha!.message).toContain("HTTP 500 Internal Server Error");
    expect(falha!.message.trim()).not.toBe("");
    expect(falha!.details).toMatchObject({ contagem: "mine", status: 500 });
  });

  it("erro com mensagem do banco preserva a mensagem e o código", () => {
    const falha = primeiraFalhaDaContagem({
      all: {
        error: { message: "canceling statement due to statement timeout", code: "57014" },
        status: 500,
        statusText: "",
      },
    });
    expect(falha!.message).toBe(
      'Contagem "all" falhou (HTTP 500): canceling statement due to statement timeout',
    );
    expect(falha!.details).toMatchObject({ pg_code: "57014", status_text: null });
  });

  it("reporta a PRIMEIRA contagem que falhou", () => {
    const erro = { error: { message: "x" }, status: 503, statusText: "" };
    expect(primeiraFalhaDaContagem({ fila: ok, automatico: erro, closed: erro })!.details.contagem).toBe(
      "automatico",
    );
  });
});
