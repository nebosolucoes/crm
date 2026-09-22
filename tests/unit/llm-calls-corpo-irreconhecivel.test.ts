/**
 * "Invalid JSON response" TEM motivo — e a tela precisa dele.
 *
 * Medido em 2026-09-21 com Gemini 3.5 Flash Lite: a execução falhou em 7,4 s
 * com 0 tokens e a tela de Execuções mostrou `erro_desconhecido` + a frase do
 * SDK, sem trace. A frase é do `@ai-sdk/provider-utils`
 * (`createJsonResponseHandler`) e é sempre a mesma: o provedor respondeu 2xx e
 * o corpo não passou no schema Zod do provider. O MOTIVO fica em
 * `responseBody` e `cause` do `APICallError` — e `normalizarErro` lia só
 * `err.message`, descartando os dois.
 *
 * O caso mais comum é o Gemini barrar o PEDIDO pelo filtro de segurança dele:
 * a resposta traz `promptFeedback.blockReason` e nenhum `candidates`, e o
 * schema do `@ai-sdk/google` exige `candidates`. Isso não é chave, saldo nem
 * rede — e mandar o operador trocar a chave seria a orientação errada.
 */
import { APICallError, TypeValidationError } from "ai";
import { describe, expect, it } from "vitest";

import { normalizarErro } from "@/lib/agent-engine/edge/llm/run-model-call";

const URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

function erroDoSdk(responseBody: string, cause?: unknown): APICallError {
  return new APICallError({
    message: "Invalid JSON response",
    cause,
    statusCode: 200,
    responseHeaders: {},
    responseBody,
    url: URL,
    requestBodyValues: {},
  });
}

describe("normalizarErro dá nome ao corpo que o SDK não reconheceu", () => {
  it("Gemini barrou o prompt pelo filtro de segurança → bloqueado_pelo_provedor", () => {
    const corpo = JSON.stringify({
      promptFeedback: { blockReason: "SAFETY", safetyRatings: [] },
      usageMetadata: { promptTokenCount: 0, totalTokenCount: 0 },
    });
    const n = normalizarErro(erroDoSdk(corpo));
    expect(n.error_code).toBe("bloqueado_pelo_provedor");
    expect(n.error_message).toContain("SAFETY");
    expect(n.http_status).toBe(200);
  });

  it("proxy devolvendo HTML com 200 → resposta_invalida, com o início do corpo", () => {
    const n = normalizarErro(erroDoSdk("<!doctype html><html><body>Bad gateway</body></html>"));
    expect(n.error_code).toBe("resposta_invalida");
    expect(n.error_message).toContain("não é JSON");
    expect(n.error_message).toContain("<!doctype html>");
  });

  it("corpo vazio → resposta_invalida dizendo que veio vazio", () => {
    const n = normalizarErro(erroDoSdk(""));
    expect(n.error_code).toBe("resposta_invalida");
    expect(n.error_message).toContain("vazio");
  });

  it("JSON que esta versão do SDK não conhece → chaves de topo + razão do validador", () => {
    const valor = { candidates: "isto-nao-e-array", usageMetadata: {} };
    const causa = new TypeValidationError({
      value: valor,
      cause: new Error("Invalid input: expected array, received string at candidates"),
    });
    const n = normalizarErro(erroDoSdk(JSON.stringify(valor), causa));
    expect(n.error_code).toBe("resposta_invalida");
    expect(n.error_message).toContain("candidates, usageMetadata");
    expect(n.error_message).toContain("expected array");
    // O corpo inteiro NÃO entra: já está resumido pelas chaves.
    expect(n.error_message).not.toContain("isto-nao-e-array");
  });

  it("gateway que embrulha erro num 200 → o texto do gateway, não o nosso", () => {
    const corpo = JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Unknown name thinkingConfig" } });
    const n = normalizarErro(erroDoSdk(corpo));
    expect(n.error_code).toBe("resposta_invalida");
    expect(n.error_message).toContain("Unknown name thinkingConfig");
    expect(n.error_message).toContain("INVALID_ARGUMENT");
  });

  // Este caso achou um defeito anterior a ele: as duas regex de chave em
  // `redigirMensagemDoProvedor` tinham um BACKSPACE literal (0x08) onde
  // deveria estar `\b` (limite de palavra) — alguma ferramenta converteu o escape ao gravar o
  // arquivo. `/\x08sk-…/` não casa com nada, e a redação de `sk-…`/`AIza…`
  // prometida no comentário nunca aconteceu. Nenhum teste a exercitava.
  it("redige a chave do Google que o corpo ecoe", () => {
    const n = normalizarErro(erroDoSdk("<html>key AIzaSyABCDEFGHIJKLMNOPQRSTUV rejected</html>"));
    expect(n.error_message).not.toContain("AIzaSyABCDEFGHIJKLMNOPQRSTUV");
    expect(n.error_message).toContain("[CHAVE]");
  });

  it("redige a chave sk-… que o corpo ecoe", () => {
    const n = normalizarErro(erroDoSdk("<html>invalid key sk-proj-QUE-NAO-PODE-VAZAR-9f3a2b</html>"));
    expect(n.error_message).not.toContain("sk-proj-QUE-NAO-PODE-VAZAR-9f3a2b");
    expect(n.error_message).toContain("[CHAVE]");
  });

  it("um APICallError com OUTRA mensagem segue a régua antiga", () => {
    const e = new APICallError({
      message: "Unauthorized",
      statusCode: 401,
      responseHeaders: {},
      responseBody: "{}",
      url: URL,
      requestBodyValues: {},
    });
    expect(normalizarErro(e).error_code).toBe("credencial_recusada");
  });
});

describe("as tabelas de orientação ao operador conhecem os dois baldes novos", () => {
  // Código sem orientação cai em "não conseguimos classificar" — o mesmo texto
  // de antes, e o conserto some da tela.
  it("tela de Execuções e botão Testar", async () => {
    const fs = await import("node:fs");
    const runs = fs.readFileSync("app/api/v1/ai/runs/route.ts", "utf8");
    const teste = fs.readFileSync("app/api/v1/ai/agents/[id]/versions/[vid]/test/route.ts", "utf8");
    for (const codigo of ["bloqueado_pelo_provedor", "resposta_invalida"]) {
      expect(runs, `runs/route.ts sem orientação para ${codigo}`).toMatch(new RegExp(`^[ ]*${codigo}:`, "m"));
      expect(teste, `test/route.ts sem orientação para ${codigo}`).toMatch(new RegExp(`^[ ]*${codigo}:`, "m"));
    }
  });
});
