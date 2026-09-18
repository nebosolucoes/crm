import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateMarcaDaOrganizacao } from "@/app/actions/settings/updateMarcaDaOrganizacao";
import { NAV_DESTINATIONS, hubSections } from "@/lib/navigation/registry";
import { resolverMarcaDaOrganizacao } from "@/lib/branding/organizacao";

const { loadAuthUser, notFound, createAdminClient } = vi.hoisted(() => ({
  loadAuthUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  createAdminClient: vi.fn(() => {
    throw new Error("createAdminClient nao deveria ser chamado");
  }),
}));

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: () => loadAuthUser(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClient(),
}));

vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: async () => null,
  supportWriteError: () => false,
}));

vi.mock("@/lib/branding/instalacao", () => ({
  marcaDaInstalacao: async () => ({
    app_name: "Plataforma Global",
    logo_url: null,
    logo_path: null,
    accent_hex: "#2563eb",
    show_powered_by: true,
    seeded_from_env: false,
    fallback_at: null,
    fallback_reason: null,
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    APP_NAME: "Env Global",
    APP_LOGO_URL: undefined,
    APP_ACCENT_HEX: "#123456",
  },
}));

vi.mock("@/app/admin/(protected)/marca/_form", () => ({
  FormularioDaMarca: () => <div data-testid="formulario-marca-admin" />,
}));

describe("marca visual exclusiva da plataforma", () => {
  beforeEach(() => {
    loadAuthUser.mockReset();
    notFound.mockClear();
    createAdminClient.mockClear();
  });

  it("admin de tenant não vê Marca nas Configurações", () => {
    expect(NAV_DESTINATIONS.some((d) => d.href === "/app/settings/marca")).toBe(false);
    expect(
      hubSections("organizacao", false, "admin").some((section) =>
        section.items.some((item) => item.label === "Marca"),
      ),
    ).toBe(false);
  });

  it("/app/settings/marca não é acessível como rota tenant", async () => {
    const { default: Page } = await import("@/app/app/settings/marca/page");
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("updateMarcaDaOrganizacao retorna forbidden sem escrever no banco", async () => {
    loadAuthUser.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000001",
      support: null,
    });

    await expect(
      updateMarcaDaOrganizacao({ app_name: "Loja da Ana", accent_hex: "#b3261e" }),
    ).resolves.toEqual({ ok: false, error: "forbidden_role" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("upload de logo por organização é proibido antes de tocar storage", async () => {
    loadAuthUser.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000001",
      is_platform_admin: false,
      support: null,
    });
    const form = new FormData();
    form.set("escopo", "organizacao");

    const { POST } = await import("@/app/api/v1/marca/logo/route");
    const resposta = await POST({
      formData: async () => form,
      headers: new Headers(),
    } as never);
    const body = await resposta.json();

    expect(resposta.status).toBe(403);
    expect(body.error.code).toBe("forbidden_role");
    expect(createAdminClient).not.toHaveBeenCalled();
  });


  it("settings.branding antigo não altera a marca resolvida do app", () => {
    const marca = resolverMarcaDaOrganizacao(
      { branding: { app_name: "Loja da Ana", accent_hex: "#b3261e" } },
      { app_name: "Plataforma Global", logo_url: null, accent_hex: "#2563eb" },
      { APP_NAME: "Env Global", APP_ACCENT_HEX: "#123456" },
    );

    expect(marca.name).toBe("Plataforma Global");
    expect(marca.cor?.semente).toBe("#2563eb");
    expect(marca.origens.nome).toBe("banco");
    expect(marca.origens.cor).toBe("banco");
  });

  it("/admin/marca continua disponível para platform admin", async () => {
    loadAuthUser.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000002",
      is_platform_admin: true,
      locale: "pt-BR",
    });

    const { default: Page } = await import("@/app/admin/(protected)/marca/page");
    const arvore = await Page();

    expect(arvore).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });
});
