/**
 * Toda página de `app/app/**` cujo destino tem recurso chama `exigirRecurso()`
 * com o recurso CERTO — e nenhuma página do produto chama.
 *
 * O gate de página é por página (o porquê está em `lib/entitlements/exigir.ts`),
 * e por página é como se esquece: uma tela nova em `app/app/ai/novidade/`
 * nasce sem a linha e fica aberta com tudo verde. Esta cerca deriva o recurso
 * esperado do MESMO lugar que o Sidebar usa (`recursoDaPagina`, que lê o
 * catálogo de navegação) e cobra a chamada no texto-fonte da página.
 *
 * Página que nenhum mapa conhece reprova com "declare": em
 * `RECURSO_POR_PAGINA_FORA_DO_CATALOGO` (null se for do produto) ou no
 * catálogo. Nunca "liberado por omissão".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RECURSOS, sempreLigado } from "@/lib/entitlements/recursos";
import { recursoDaPagina } from "@/lib/entitlements/paginas";

const RAIZ = join(__dirname, "..", "..");
const APP = join(RAIZ, "app", "app");

function paginas(dir: string, rota: string): Array<{ arquivo: string; rota: string }> {
  const saida: Array<{ arquivo: string; rota: string }> = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (!nome.startsWith("_")) saida.push(...paginas(p, `${rota}/${nome}`));
    } else if (nome === "page.tsx") {
      saida.push({ arquivo: p, rota });
    }
  }
  return saida;
}

function recursosExigidos(fonte: string): string[] {
  return [...fonte.matchAll(/exigirRecurso\("([a-z_]+)"\)/g)].map((m) => m[1]!);
}

const todas = paginas(APP, "/app");

describe("páginas do tenant × recurso do plano", () => {
  it("a varredura acha páginas (guarda de vacuidade)", () => {
    expect(todas.length).toBeGreaterThan(50);
  });

  it("toda página é conhecida pelo catálogo ou pelo mapa de fora — nunca 'liberada por omissão'", () => {
    const desconhecidas = todas.filter(({ rota }) => recursoDaPagina(rota) === undefined).map(({ rota }) => rota);
    expect(desconhecidas, "declare em lib/entitlements/paginas.ts (null se for do produto) ou no catálogo").toEqual([]);
  });

  it("página de destino vendável chama exigirRecurso com o recurso do destino; página do produto não chama", () => {
    const problemas: string[] = [];
    for (const { arquivo, rota } of todas) {
      const esperado = recursoDaPagina(rota);
      const exigidos = recursosExigidos(readFileSync(arquivo, "utf8"));
      if (esperado === null || esperado === undefined || sempreLigado(esperado)) {
        if (exigidos.length) problemas.push(`${rota}: página do produto chama exigirRecurso(${exigidos.join(",")})`);
        continue;
      }
      if (!exigidos.includes(esperado)) {
        problemas.push(`${rota}: exige "${esperado}" e chama ${exigidos.length ? exigidos.join(",") : "NADA"}`);
      }
      const estranhos = exigidos.filter((e) => e !== esperado);
      if (estranhos.length) problemas.push(`${rota}: chama ${estranhos.join(",")} além de "${esperado}"`);
    }
    expect(problemas).toEqual([]);
  });

  it("a chamada é a PRIMEIRA coisa da página — antes de qualquer consulta", () => {
    // Uma `await exigirRecurso` depois de um `await supabase…` já gastou a
    // consulta que o gate existe para poupar, e pode até vazar dado no erro.
    const tardias: string[] = [];
    for (const { arquivo, rota } of todas) {
      const fonte = readFileSync(arquivo, "utf8");
      const gate = fonte.indexOf("await exigirRecurso(");
      if (gate === -1) continue;
      const corpo = fonte.indexOf("export default");
      const primeiroAwait = fonte.indexOf("await ", corpo);
      if (primeiroAwait !== -1 && primeiroAwait < gate) tardias.push(rota);
    }
    expect(tardias).toEqual([]);
  });

  it("todo recurso chamado existe no vocabulário", () => {
    for (const { arquivo, rota } of todas) {
      for (const e of recursosExigidos(readFileSync(arquivo, "utf8"))) {
        expect((RECURSOS as readonly string[]).includes(e), `${rota}: ${e}`).toBe(true);
      }
    }
  });

  it("o instrumento enxerga a violação (controle negativo)", () => {
    expect(recursosExigidos('await exigirRecurso("crm");')).toEqual(["crm"]);
    expect(recursosExigidos("const x = 1;")).toEqual([]);
  });
});
