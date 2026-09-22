/**
 * TEMA ESCURO DESLIGADO — o produto só entrega o claro, sem apagar o escuro.
 *
 * Decisão do dono do produto em 2026-09-21 (`lib/tema-escuro.ts`). Este
 * arquivo prova as quatro portas por onde o escuro poderia entrar mesmo com a
 * chave desligada, e uma de vacuidade: que a chave está, de fato, desligada.
 *
 * As portas:
 * 1. localStorage com "dark" salvo de antes — o `ThemeProvider` tem de pintar
 *    `data-theme="light"` e não pode devolver `theme: "dark"` a quem lê o hook.
 * 2. SO em modo escuro com preferência "system" — idem.
 * 3. `setTheme("dark")` / `toggle()` — o pedido é reduzido a "light" e o que
 *    fica gravado é "light".
 * 4. O script anti-flash de `app/layout.tsx` — se ele consultasse o
 *    localStorage, quem tinha "dark" veria um frame escuro antes do React
 *    corrigir. Com a chave desligada ele tem de ser um `setAttribute` cru.
 *
 * E o botão: `ThemeToggle` não renderiza nada. A mecânica de hidratação do
 * escuro segue provada em `lib/theme.test.tsx`, que força a chave para ligada.
 *
 * Quando a chave religar, a suíte inteira aqui deve ser APAGADA junto com o
 * `it.skipIf` — não adaptada: o comportamento que ela mede deixa de existir.
 */
import { readFileSync } from "node:fs";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMA_ESCURO_HABILITADO } from "@/lib/tema-escuro";
import type { ThemeProvider as ThemeProviderType, useTheme as useThemeType } from "@/lib/theme";
import type { ThemeToggle as ThemeToggleType } from "@/components/theme/theme-toggle";

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: () => {} }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

const CHAVE = "deskcomm-theme";

function stubMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("dark") && prefersDark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

let ThemeProvider: typeof ThemeProviderType;
let useTheme: typeof useThemeType;
let ThemeToggle: typeof ThemeToggleType;

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  // Mesmo motivo de `lib/theme.test.tsx`: o cache do external store mora no
  // módulo, e cada `it` precisa de um módulo zerado.
  vi.resetModules();
  ({ ThemeProvider, useTheme } = await import("@/lib/theme"));
  ({ ThemeToggle } = await import("@/components/theme/theme-toggle"));
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type Sonda = { theme: string; resolvedTheme: string; setTheme: (t: "light" | "dark" | "system") => void; toggle: () => void };

/** Monta o provider com uma sonda que expõe o hook, e devolve a sonda viva. */
function montar(): Sonda {
  const sonda: Partial<Sonda> = {};
  function Sonda() {
    const v = useTheme();
    Object.assign(sonda, v);
    return <span data-testid="tema">{v.theme}</span>;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <ThemeProvider>
        <Sonda />
        <ThemeToggle />
      </ThemeProvider>,
    );
  });
  return sonda as Sonda;
}

describe.skipIf(TEMA_ESCURO_HABILITADO)("com o tema escuro desligado", () => {
  it("VACUIDADE: a chave está desligada de fato", () => {
    expect(TEMA_ESCURO_HABILITADO).toBe(false);
  });

  it("(1) 'dark' salvo no localStorage não escurece a página", () => {
    window.localStorage.setItem(CHAVE, "dark");
    stubMatchMedia(false);
    const s = montar();
    expect(s.theme).toBe("light");
    expect(s.resolvedTheme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("(2) SO escuro com preferência 'system' não escurece a página", () => {
    window.localStorage.setItem(CHAVE, "system");
    stubMatchMedia(true);
    const s = montar();
    expect(s.resolvedTheme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("(3) setTheme('dark') e toggle() ficam no claro — e é claro o que se grava", () => {
    stubMatchMedia(true);
    const s = montar();
    act(() => s.setTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(CHAVE)).toBe("light");
    act(() => s.toggle());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(CHAVE)).toBe("light");
  });

  it("o botão de tema não existe", () => {
    stubMatchMedia(false);
    montar();
    expect(document.body.querySelector("button")).toBeNull();
  });

  it("(4) o script anti-flash do layout pinta claro sem consultar o localStorage", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    // O ramo desligado tem de existir, ser o `setAttribute` cru, e estar
    // condicionado pela chave — não por outra coisa.
    expect(layout).toMatch(/const THEME_INIT_SCRIPT = TEMA_ESCURO_HABILITADO\s*\?/);
    expect(layout).toContain(": `document.documentElement.setAttribute('data-theme','light');`");
    // E a barra do navegador acompanha: sem a chave, só a cor do claro.
    expect(layout).toMatch(/themeColor: TEMA_ESCURO_HABILITADO\s*\?/);
  });
});

describe("a chave é o ÚNICO lugar que decide", () => {
  it("quem consulta a chave importa de lib/tema-escuro, não repete o literal", () => {
    for (const arquivo of ["lib/theme.tsx", "components/theme/theme-toggle.tsx", "app/layout.tsx"]) {
      const s = readFileSync(arquivo, "utf8");
      expect(s, `${arquivo} não importa a chave`).toContain('from "@/lib/tema-escuro"');
      expect(s, `${arquivo} redeclara a chave`).not.toMatch(/const TEMA_ESCURO_HABILITADO\s*=/);
    }
  });
});
