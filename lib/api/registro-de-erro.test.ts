import type * as NextServer from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Record<string, unknown>[] = [];
const afterCallbacks: (() => Promise<void> | void)[] = [];

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof NextServer>()),
  after: (cb: () => Promise<void> | void) => {
    afterCallbacks.push(cb);
  },
}));
let idDoProxy: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-method": "PATCH",
      "x-pathname": "/api/v1/leads/abc",
      ...(idDoProxy ? { "x-request-id": idDoProxy } : {}),
    }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

import {
  detalhesGravaveis,
  ehClienteQueDesistiu,
  registrarErroDaApi,
  registrarExcecaoDeRequest,
} from "./registro-de-erro";
import { fail } from "./wrappers";

describe("registro de erros da API (migration 0288)", () => {
  const vitestOriginal = process.env.VITEST;

  beforeEach(() => {
    inserts.length = 0;
    afterCallbacks.length = 0;
    idDoProxy = null;
    // O módulo se cala sob o Vitest para não poluir a suíte; aqui é ele o alvo.
    delete process.env.VITEST;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.VITEST = vitestOriginal;
    vi.restoreAllMocks();
  });

  it("fail() grava o MESMO ID que devolve no cabeçalho, com rota e usuário", async () => {
    const res = fail("validation_error", "Campo inválido", 422, { details: { campo: "nome" } });
    const id = res.headers.get("X-Request-Id");

    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]!();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(id!));

    expect(inserts).toEqual([
      {
        request_id: id,
        method: "PATCH",
        path: "/api/v1/leads/abc",
        status: 422,
        code: "validation_error",
        message: "Campo inválido",
        details: { campo: "nome" },
        user_id: "user-1",
      },
    ]);
  });

  it("grava o ID do proxy — o que vence na resposta e a tela mostra —, não o sorteado pelo fail()", async () => {
    idDoProxy = "id-do-proxy-0dbf7a63";
    fail("validation_error", "Campo inválido", 422);
    await afterCallbacks[0]!();
    expect(inserts[0]).toMatchObject({ request_id: "id-do-proxy-0dbf7a63" });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("id-do-proxy-0dbf7a63"));
  });

  it("5xx vai para console.error; 401 não tenta resolver usuário", async () => {
    registrarErroDaApi({ requestId: "r-500", status: 500, code: "internal_error", message: "x" });
    await afterCallbacks[0]!();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("r-500"));

    registrarErroDaApi({ requestId: "r-401", status: 401, code: "unauthenticated", message: "x" });
    await afterCallbacks[1]!();
    expect(inserts[1]).toMatchObject({ request_id: "r-401", user_id: null });
  });

  it("exceção não tratada grava pelo digest que a tela mostra", async () => {
    const err = Object.assign(new Error("quebrou"), { digest: "123456789" });
    await registrarExcecaoDeRequest(err, { path: "/app/inbox", method: "GET", headers: {} });
    expect(inserts[0]).toMatchObject({
      request_id: "123456789",
      path: "/app/inbox",
      method: "GET",
      status: 500,
      code: "unhandled_exception",
      message: "quebrou",
    });
  });

  it("cliente que fechou a conexão no meio do streaming NÃO vira linha", async () => {
    // Produção, 04/11/2026: "The destination stream closed early." em /app/inbox virou card.
    await registrarExcecaoDeRequest(new Error("The destination stream closed early."), {
      path: "/app/inbox",
      method: "GET",
      headers: {},
    });
    await registrarExcecaoDeRequest(Object.assign(new Error("x"), { code: "ECONNRESET" }), { headers: {} });
    expect(inserts).toHaveLength(0);
    expect(ehClienteQueDesistiu(new Error("quebrou"))).toBe(false);
  });

  it("detalhes grandes são truncados, nunca gravados inteiros", () => {
    const grande = { texto: "a".repeat(10_000) };
    expect(detalhesGravaveis(grande)).toMatchObject({ truncado: true });
    expect(detalhesGravaveis(undefined)).toBeNull();
  });

  it("sob o Vitest não grava nada (a suíte chama fail() milhares de vezes)", () => {
    process.env.VITEST = "true";
    registrarErroDaApi({ requestId: "r", status: 400, code: "c", message: "m" });
    expect(afterCallbacks).toHaveLength(0);
  });
});
