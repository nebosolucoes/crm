import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

let linha: Record<string, unknown> | null = null;
let erro: { code: string } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: linha, error: erro }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: async (_admin: unknown, cifrado: string) =>
    cifrado === "\\xcifrado" ? "segredo-do-widget" : null,
}));

import { hashDaIdentidade, invalidarWidgetDeSuporte, widgetDeSuporteParaTela } from "./widget";

const usuario = { id: "u-1", email: "ana@empresa.com", full_name: "Ana Souza" };

describe("widget de suporte da instalação (migration 0289)", () => {
  beforeEach(() => {
    invalidarWidgetDeSuporte();
    erro = null;
    linha = {
      enabled: true,
      script_url: "https://suporte.exemplo.com/widget.js",
      public_key: "pk_teste",
      hmac_secret_encrypted: "\\xcifrado",
    };
  });

  it("o hash é o HMAC-SHA256 hex do id, que a central confere", () => {
    const esperado = createHmac("sha256", "s").update("42").digest("hex");
    expect(hashDaIdentidade("s", "42")).toBe(esperado);
  });

  it("ligado: entrega script, chave e identidade com hash — e nunca o segredo", async () => {
    const w = await widgetDeSuporteParaTela(usuario, "ACME");
    expect(w).toEqual({
      scriptUrl: "https://suporte.exemplo.com/widget.js",
      publicKey: "pk_teste",
      identidade: {
        id: "u-1",
        nome: "Ana Souza",
        email: "ana@empresa.com",
        empresa: "ACME",
        hash: hashDaIdentidade("segredo-do-widget", "u-1"),
      },
    });
    expect(JSON.stringify(w)).not.toContain("segredo-do-widget");
  });

  it("desligado, sem chave ou sem tabela: nenhum script de terceiro", async () => {
    linha = { ...linha, enabled: false };
    expect(await widgetDeSuporteParaTela(usuario, null)).toBeNull();

    invalidarWidgetDeSuporte();
    linha = { enabled: true, script_url: "https://x/widget.js", public_key: "" };
    expect(await widgetDeSuporteParaTela(usuario, null)).toBeNull();

    invalidarWidgetDeSuporte();
    linha = null;
    erro = { code: "42P01" };
    expect(await widgetDeSuporteParaTela(usuario, null)).toBeNull();
  });

  it("segredo que não decifra: o botão continua, a identidade vai sem hash", async () => {
    linha = { ...linha, hmac_secret_encrypted: "\\xoutro" };
    const w = await widgetDeSuporteParaTela(usuario, null);
    expect(w?.identidade.hash).toBeNull();
  });
});
