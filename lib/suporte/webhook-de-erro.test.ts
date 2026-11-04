import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let linha: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: linha, error: null }) }) }),
    }),
  }),
}));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: async () => "segredo-da-integracao",
}));

import {
  TETO_POR_MINUTO,
  avisarErro,
  chaveDoAgrupamento,
  corpoDoAviso,
  enderecoPermitido,
  idExternoAgrupado,
  invalidarWebhookDeErro,
  type ErroParaAvisar,
} from "./webhook-de-erro";

const erro = (status = 422): ErroParaAvisar => ({
  requestId: "0dbf7a63-5f9a-482c-bb6d-153987baecc6",
  status,
  code: "validation_error",
  message: "Campo inválido",
  method: "PATCH",
  path: "/api/v1/leads/abc",
  details: { campo: "nome" },
  usuario: { id: "u-1", email: "ana@empresa.com", nome: "Ana" },
  quando: new Date("2026-10-30T12:00:00Z"),
});

describe("webhook de erro (migration 0290)", () => {
  const chamadas: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    invalidarWebhookDeErro();
    globalThis.__janelaDoWebhookDeErro = undefined;
    globalThis.__gruposAvisadosDoWebhookDeErro = undefined;
    chamadas.length = 0;
    linha = { enabled: true, url: "https://task.exemplo.com/api/integracoes/tok", secret_encrypted: "\\xc", scope: "all" };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response("{}", { status: 201 });
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o corpo segue o formato da integração por webhook do Task, com o ID do erro como id_externo", () => {
    const corpo = corpoDoAviso(erro(), "https://crm.exemplo.com");
    expect(corpo).toMatchObject({
      titulo: "Erro 422 no CRM: validation_error em PATCH /api/v1/leads/abc",
      descricao: "Campo inválido",
      prioridade: "media",
      id_externo: "0dbf7a63-5f9a-482c-bb6d-153987baecc6",
      solicitante: { nome: "Ana", email: "ana@empresa.com" },
    });
    expect(corpo.campos).toMatchObject({ "ID do erro": "0dbf7a63-5f9a-482c-bb6d-153987baecc6", Status: "422", "Instalação": "https://crm.exemplo.com" });
    expect(corpoDoAviso(erro(500), null).prioridade).toBe("alta");
  });

  it("envia assinado com X-Nebo-Assinatura = sha256=HMAC(segredo, corpo)", async () => {
    await avisarErro(erro());
    expect(chamadas).toHaveLength(1);
    const { url, init } = chamadas[0]!;
    expect(url).toBe("https://task.exemplo.com/api/integracoes/tok");
    const esperado = `sha256=${createHmac("sha256", "segredo-da-integracao").update(String(init.body)).digest("hex")}`;
    expect((init.headers as Record<string, string>)["X-Nebo-Assinatura"]).toBe(esperado);
  });

  it("desligado não envia; escopo 'server' só manda 5xx", async () => {
    linha = { ...linha, enabled: false };
    await avisarErro(erro(500));
    expect(chamadas).toHaveLength(0);

    invalidarWebhookDeErro();
    linha = { ...linha, enabled: true, scope: "server" };
    await avisarErro(erro(422));
    expect(chamadas).toHaveLength(0);
    await avisarErro(erro(500));
    expect(chamadas).toHaveLength(1);
  });

  it("rajada de erros DIFERENTES: passa do teto por minuto e para de enviar", async () => {
    for (let i = 0; i < TETO_POR_MINUTO + 5; i += 1) await avisarErro({ ...erro(), code: `codigo_${"x".repeat(i)}` });
    expect(chamadas).toHaveLength(TETO_POR_MINUTO);
  });

  it("o MESMO erro repetido na mesma hora vira um aviso só, com id_externo agrupado", async () => {
    // Produção, 03–04/11/2026: 515 timeouts da mesma rota viraram 515 cards.
    for (let i = 0; i < 10; i += 1) {
      await avisarErro({ ...erro(500), requestId: `req-${i}`, path: `/api/v1/leads/${i}?cursor=${i}` });
    }
    expect(chamadas).toHaveLength(1);
    const corpo = JSON.parse(String(chamadas[0]!.init.body)) as { id_externo: string; campos: Record<string, string> };
    expect(corpo.id_externo).toMatch(/^crm-erro:[0-9a-f]{16}:2026-10-30T12$/);
    expect(corpo.campos["ID do erro"]).toBe("req-0");
  });

  it("na hora seguinte o mesmo erro abre outro card; entrega que falhou tenta de novo", async () => {
    await avisarErro(erro(500));
    await avisarErro({ ...erro(500), quando: new Date("2026-10-30T13:05:00Z") });
    expect(chamadas).toHaveLength(2);

    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response("{}", { status: 502 });
    }));
    const outro = { ...erro(500), code: "outro" };
    await avisarErro(outro);
    await avisarErro(outro);
    expect(chamadas).toHaveLength(4);
  });

  it("a chave ignora IDs, números e query; separa status, código e rota", () => {
    const a = { ...erro(500), path: "/api/v1/leads/0dbf7a63-5f9a-482c-bb6d-153987baecc6?x=1", message: "lote 12 falhou" };
    const b = { ...erro(500), path: "/api/v1/leads/11111111-2222-4333-8444-555555555555", message: "lote 99 falhou" };
    expect(chaveDoAgrupamento(a)).toBe(chaveDoAgrupamento(b));
    expect(idExternoAgrupado(a)).toBe(idExternoAgrupado(b));
    expect(chaveDoAgrupamento({ ...a, status: 503 })).not.toBe(chaveDoAgrupamento(a));
    expect(chaveDoAgrupamento({ ...a, path: "/api/v1/contacts/1" })).not.toBe(chaveDoAgrupamento(a));
  });

  it("destino fora do ar não lança (um erro ao avisar de um erro não pode virar outro)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(avisarErro(erro())).resolves.toBeUndefined();
  });

  it("em produção só https público; fora dela http/localhost servem para testar", () => {
    expect(enderecoPermitido("https://task.exemplo.com/api/integracoes/x", true)).toBe(true);
    expect(enderecoPermitido("http://task.exemplo.com/x", true)).toBe(false);
    expect(enderecoPermitido("https://127.0.0.1/x", true)).toBe(false);
    expect(enderecoPermitido("http://localhost:3110/api/integracoes/x", false)).toBe(true);
    expect(enderecoPermitido("ftp://x", false)).toBe(false);
  });
});
