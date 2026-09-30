/**
 * Publicações usa portas REAIS de navegação: cinco páginas no menu (Lista,
 * Agendar, Calendário, Grupos, Histórico), nenhum seletor de sub-abas no
 * meio da tela, e as rotas antigas do Disparo só redirecionam. Substitui o
 * `disparo-navegacao.test.ts`, que lia o client antigo (removido na 0283).
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { NAV_CATALOG } from "@/lib/navigation/catalogo";

const PAGINAS = ["lista", "agendar", "calendario", "grupos", "historico"] as const;

describe("Publicações — portas reais de navegação", () => {
  it("as cinco páginas existem no disco e no catálogo, no grupo publicacoes", () => {
    for (const p of PAGINAS) {
      expect(existsSync(`app/app/publicacoes/${p}/page.tsx`), p).toBe(true);
      const entrada = NAV_CATALOG.find((d) => d.href === `/app/publicacoes/${p}`);
      expect(entrada, `catálogo: /app/publicacoes/${p}`).toBeDefined();
      expect(entrada?.group).toBe("publicacoes");
    }
  });

  it("nenhum client renderiza seletor de sub-abas no meio da página", () => {
    for (const p of PAGINAS) {
      const fonte = readFileSync(`app/app/publicacoes/${p}/_client.tsx`, "utf8");
      expect(fonte, p).not.toContain("TabsTrigger");
    }
  });

  it("as rotas antigas do Disparo e de agendamentos só redirecionam para Publicações", () => {
    for (const p of ["lista", "agendar", "grupos", "historico"]) {
      const fonte = readFileSync(`app/app/disparo/${p}/page.tsx`, "utf8");
      expect(fonte).toContain(`redirect("/app/publicacoes/${p}")`);
    }
    expect(readFileSync("app/app/agendamentos/page.tsx", "utf8")).toContain('redirect("/app/publicacoes/lista")');
    expect(existsSync("app/app/agendamentos/_client.tsx")).toBe(false);
  });

  it("o formulário sobe pela rota nova de mídia e chama a API de Publicações", () => {
    const hook = readFileSync("hooks/publicacoes/usePublicacoes.ts", "utf8");
    expect(hook).toContain('"/api/v1/publicacoes"');
    expect(hook).toContain("/media");
    const form = readFileSync("components/publicacoes/FormularioDePublicacao.tsx", "utf8");
    expect(form).toContain("<SeletorDeDestinos");
    expect(form).toContain("<SeletorDeHorarios");
    expect(form).toContain("<DropzoneDeMidia");
    // A prévia é um carrossel por destino; o celular do WhatsApp mora dentro dele.
    expect(form).toContain("<PreviaDosDestinos");
    const previa = readFileSync("components/publicacoes/previa/PreviaDosDestinos.tsx", "utf8");
    expect(previa).toContain("<PreviaDoCelular");
    expect(previa).toContain("<PreviaDoFeed");
    expect(previa).toContain("<PreviaDoStory");
    expect(previa).toContain("<PreviaDoReel");
    // Cada data escolhe suas redes (0284): o formulário manda `occurrences` com os destinos por data.
    expect(form).toContain("occurrences: horarios.map(");
    expect(form).toContain("destinosDaLinha(h, destinos)");
  });
});
