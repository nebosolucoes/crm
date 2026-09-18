import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { requireAuthMock, resolveActiveOrgMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  resolveActiveOrgMock: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuth: requireAuthMock,
  resolveActiveOrg: resolveActiveOrgMock,
  // `exigirRecurso` (migration 0275) resolve a sessão por aqui também.
  loadAuthUser: requireAuthMock,
}));
// O plano da organização: o hub de IA exige `ai_agents`; aqui a organização
// fictícia tem tudo, como o legado.
vi.mock("@/lib/entitlements/resolver", () => ({
  orgTemRecurso: async () => true,
  entitlementsDaOrg: async () => ({
    plan: null,
    origem: "atribuido",
    features: new Set(["channels", "inbox", "broadcast", "crm", "ai_agents", "analytics"]),
    limits: {},
    overrides: [],
  }),
}));

vi.mock("@/components/shell/NavHub", () => ({
  NavHub: ({ locale }: { locale?: string }) => <div data-testid="ai-hub" data-locale={locale} />,
}));

import AiHubPage from "./page";

afterEach(cleanup);

describe("AiHubPage", () => {
  it("entrega ao hub o idioma resolvido para a pessoa e a organização", async () => {
    requireAuthMock.mockResolvedValue({
      idioma: "es",
      is_platform_admin: false,
      support: false,
    });
    resolveActiveOrgMock.mockResolvedValue({ role: "admin", interface_settings: undefined });

    render(await AiHubPage());

    expect(screen.getByTestId("ai-hub")).toHaveAttribute("data-locale", "es");
  });
});
