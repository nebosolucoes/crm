import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = { NEXT_PUBLIC_APP_URL: "" };
vi.mock("@/lib/env", () => ({ env }));

const { urlPublicaDaInstalacao } = await import("./url-publica");

function pedido(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

describe("urlPublicaDaInstalacao", () => {
  beforeEach(() => {
    env.NEXT_PUBLIC_APP_URL = "";
  });

  it("configurada na rede local + pedido pelo túnel: vale o túnel (o caso de 30/09)", () => {
    env.NEXT_PUBLIC_APP_URL = "http://192.168.4.158:3001";
    const r = pedido("http://localhost:3001/api/v1/channels/social/connect", {
      origin: "https://abc-def.trycloudflare.com",
    });
    expect(urlPublicaDaInstalacao(r)).toBe("https://abc-def.trycloudflare.com");
  });

  it("a volta do OAuth (sem Origin) usa o Host repassado pelo túnel", () => {
    env.NEXT_PUBLIC_APP_URL = "http://192.168.4.158:3001";
    const r = pedido("http://localhost:3001/api/v1/channels/social/callback", {
      "x-forwarded-host": "abc-def.trycloudflare.com",
      "x-forwarded-proto": "https",
    });
    expect(urlPublicaDaInstalacao(r)).toBe("https://abc-def.trycloudflare.com");
  });

  it("configurada PÚBLICA: um Host forjado não vence", () => {
    env.NEXT_PUBLIC_APP_URL = "https://crm.cliente.com.br/";
    const r = pedido("http://localhost:3001/x", { origin: "https://atacante.example" });
    expect(urlPublicaDaInstalacao(r)).toBe("https://crm.cliente.com.br");
  });

  it("configurada local e pedido também local: fica a configurada (a guarda recusa depois)", () => {
    env.NEXT_PUBLIC_APP_URL = "http://192.168.4.158:3001";
    const r = pedido("http://192.168.4.158:3001/x", { origin: "http://192.168.4.158:3001" });
    expect(urlPublicaDaInstalacao(r)).toBe("http://192.168.4.158:3001");
  });
});
