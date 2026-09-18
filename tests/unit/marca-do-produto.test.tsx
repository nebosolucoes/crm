import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Sidebar } from "@/components/shell/Sidebar";
import {
  ARQUIVOS_DA_MARCA_DO_PRODUTO,
  LogotipoDoProduto,
  SimboloDoProduto,
} from "@/components/branding/MarcaDoProduto";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import { DEFAULT_APP_NAME, iconeEhODoProduto, marcaEhADoProduto, type Branding } from "@/lib/branding";
import { MarcaDaInstalacaoProvider } from "@/lib/branding/contexto";

/**
 * A marca do PRODUTO aparece — e SÓ aparece — quando ninguém pôs a sua.
 *
 * Neste fork a marca é a Nebo: os PNGs de `public/assets/` referenciados por
 * `components/branding/MarcaDoProduto.tsx`; a decisão continua em
 * `marcaEhADoProduto`. Este arquivo mede as duas metades: a regra pura, e a
 * regra ALCANÇANDO a barra lateral (conferir que a Sidebar importa o
 * componente não bastaria — é evidência de símbolo, não de comportamento).
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/app/inbox" }));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({ toggleSidebar: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => null,
}));
vi.mock("@/components/shell/VersionFooter", () => ({ VersionFooter: () => null }));

const usuario = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@exemplo.test",
  is_platform_admin: false,
  organizations: [],
} as unknown as AuthUser;
const org = {
  orgId: "00000000-0000-4000-8000-0000000000aa",
  name: "Loja da Ana",
  role: "admin",
} as ActiveOrg;
let contexto: { user: AuthUser; activeOrg: ActiveOrg | null } = { user: usuario, activeOrg: org };
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => contexto }));

const PADRAO: Branding = { name: DEFAULT_APP_NAME, logoUrl: null, initial: "N" };

function renderSidebar(marca: Branding, collapsed: boolean) {
  return render(
    <MarcaDaInstalacaoProvider marca={marca}>
      <Sidebar collapsed={collapsed} />
    </MarcaDaInstalacaoProvider>,
  );
}

afterEach(() => {
  cleanup();
  contexto = { user: usuario, activeOrg: org };
});

describe("marcaEhADoProduto", () => {
  it("é verdade só sem logo E com o nome padrão", () => {
    expect(marcaEhADoProduto(PADRAO)).toBe(true);
  });

  it("quem trocou o nome NÃO recebe um logotipo que soletra outro nome", () => {
    expect(marcaEhADoProduto({ name: "Acme CRM", logoUrl: null })).toBe(false);
  });

  it("quem subiu logo já tem o dele", () => {
    expect(marcaEhADoProduto({ name: DEFAULT_APP_NAME, logoUrl: "https://cdn.x/logo.png" })).toBe(
      false,
    );
  });
});

describe("os arquivos da marca existem em public/", () => {
  it.each(Object.entries(ARQUIVOS_DA_MARCA_DO_PRODUTO))("%s → %s", (_papel, caminho) => {
    // A referência é um caminho servido de `public/`; sem o arquivo no disco
    // a tela mostraria um <img> quebrado e a aba ficaria em 404.
    expect(caminho.startsWith("/assets/")).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "public", caminho))).toBe(true);
  });
});

describe("a marca do produto na barra lateral", () => {
  it("aberta e sem marca própria, mostra o logotipo do produto (<img> marcado como do produto)", () => {
    renderSidebar(PADRAO, false);
    const logotipo = screen.getByRole("img", { name: DEFAULT_APP_NAME });
    expect(logotipo.tagName.toLowerCase()).toBe("img");
    expect(logotipo.getAttribute("src")).toBe(ARQUIVOS_DA_MARCA_DO_PRODUTO.logotipo);
    // O e2e `marca-logo.spec.ts` lê "barra sem <img> de revendedor" como "sem
    // logo do revendedor"; o atributo é o que separa os dois <img>.
    expect(logotipo.hasAttribute("data-marca-do-produto")).toBe(true);
    expect(document.querySelector("img:not([data-marca-do-produto])")).toBeNull();
    // Nem o nome em texto: o logotipo já o escreve.
    expect(screen.queryByText(DEFAULT_APP_NAME)).toBeNull();
  });

  it("recolhida, mostra só o símbolo — e não a inicial em texto", () => {
    renderSidebar(PADRAO, true);
    const simbolo = screen.getByRole("img", { name: DEFAULT_APP_NAME });
    expect(simbolo.getAttribute("src")).toBe(ARQUIVOS_DA_MARCA_DO_PRODUTO.simbolo);
    expect(screen.queryByText("N")).toBeNull();
  });

  it("com nome da instalação, segue em texto — a marca do produto não vaza", () => {
    renderSidebar({ name: "Sistema do Revendedor", logoUrl: null, initial: "S" }, false);
    expect(screen.getByText("Sistema do Revendedor")).toBeTruthy();
    expect(document.querySelector("img[data-marca-do-produto]")).toBeNull();
  });

  it("com logo da instalação, a imagem do revendedor vence a do produto", () => {
    renderSidebar({ ...PADRAO, logoUrl: "https://cdn.exemplo.test/logo.png" }, false);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("https://cdn.exemplo.test/logo.png");
    expect(img.hasAttribute("data-marca-do-produto")).toBe(false);
  });
});

describe("acessibilidade da marca", () => {
  it("decorativo esconde do leitor de tela; sem isso, nomeia a marca", () => {
    render(<SimboloDoProduto nome="Marca X" decorativo />);
    const decorativo = document.querySelector("img")!;
    expect(decorativo.getAttribute("aria-hidden")).toBe("true");
    expect(decorativo.getAttribute("alt")).toBe("");
    cleanup();
    render(<LogotipoDoProduto nome="Marca X" />);
    expect(screen.getByRole("img", { name: "Marca X" })).toBeTruthy();
  });
});

describe("o favicon segue a mesma regra", () => {
  const icone = fs.readFileSync(path.join(process.cwd(), "app/icon.tsx"), "utf8");

  it("serve o favicon do produto quando o NOME é o do produto, e a inicial quando não é", () => {
    expect(icone).toMatch(/iconeEhODoProduto\(\{ name: marca\.nome \}\)/);
    expect(icone).toMatch(/ARQUIVOS_DA_MARCA_DO_PRODUTO\.favicon/);
    expect(icone).toMatch(/letraDoIcone\(marca\.nome\)/);
  });

  it("o logo subido não tira o ícone do produto; o nome trocado tira", () => {
    // O ícone não pode buscar o `logo_url` (SSRF por page load), então quem
    // manteve o nome do produto fica com o ícone dele, e não com um "N".
    expect(iconeEhODoProduto({ name: DEFAULT_APP_NAME })).toBe(true);
    expect(iconeEhODoProduto({ name: "Acme CRM" })).toBe(false);
  });
});
