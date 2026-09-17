/**
 * Toda rota de família VENDÁVEL declara o recurso do plano que exige — e
 * declara o CERTO.
 *
 * O gate de plano da API vive em `requireRole({ feature })`,
 * `resolveAuthDual({ feature })` e `recusaPorRecurso(org, feature)`. Nenhum
 * deles é automático por pasta: uma rota nova em `agendamentos/` que esqueça o
 * `feature: "broadcast"` nasce ABERTA para toda organização, com o typecheck,
 * o lint e a suíte verdes — o mesmo modo de falha mudo do `authz.denied` que
 * este repositório já pagou. Esta cerca lê o mapa único
 * (`lib/entitlements/rotas.ts`) e cobra de cada `route.ts`:
 *
 *   - família não mapeada → "declare" (nunca "liberado");
 *   - recurso `X`          → o arquivo cita `feature: "X"` ou
 *                            `recusaPorRecurso(…, "X"`;
 *   - recurso `null`       → o arquivo NÃO cita `feature:` nenhum (gatear rota
 *                            do produto por plano é o erro inverso);
 *   - recurso `X` mas o arquivo declara `Y` → o mapa e a rota discordam.
 *
 * Rota que DELEGA a guarda (a um `_action.ts` ou a outra rota) entra na
 * allowlist com o arquivo que guarda — e a cerca confere ESSE arquivo.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { RECURSOS } from "@/lib/entitlements/recursos";
import { recursoDaRota } from "@/lib/entitlements/rotas";

const RAIZ = join(__dirname, "..", "..");
const API = join(RAIZ, "app", "api", "v1");

/** Famílias com OUTRO guardião — fora do mapa e desta cerca. */
const FORA = new Set(["admin", "cron", "webhooks", "auth", "health", "system", "onboarding", "mcp"]);

/**
 * Rota → arquivo que carrega a guarda por ela, ou `null` quando não há
 * organização a gatear. Cada linha diz o porquê.
 */
const DELEGADAS: Record<string, { guarda: string | null; motivo: string }> = {
  "agenda/agendamentos/[id]/google/meet/deliver": {
    guarda: "agenda/agendamentos/[id]/google/meet/_action.ts",
    motivo: "só chama requireSupportWrite e delega a meetingAction, que faz o requireRole com feature",
  },
  "agenda/agendamentos/[id]/google/meet/retry": {
    guarda: "agenda/agendamentos/[id]/google/meet/_action.ts",
    motivo: "idem deliver",
  },
  "agenda/agendamentos/[id]/google/retry": {
    guarda: "agenda/agendamentos/[id]/google/resolver/route.ts",
    motivo: "reencaminha o POST ao resolver, que tem o requireRole com feature",
  },
  "agenda/google/callback": {
    guarda: null,
    motivo:
      "callback OAuth do Google: sem sessão (SameSite=Strict), identidade vem do state HMAC. " +
      "Só grava a credencial; quem USA a agenda passa pelas rotas gateadas",
  },
};

function rotas(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) saida.push(...rotas(p));
    else if (nome === "route.ts") saida.push(p);
  }
  return saida;
}

function relDaRota(arquivo: string): string {
  return relative(API, arquivo).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
}

function recursosDeclarados(fonte: string): string[] {
  const achados = new Set<string>();
  for (const m of fonte.matchAll(/feature:\s*"([a-z_]+)"/g)) achados.add(m[1]!);
  for (const m of fonte.matchAll(/recusaPorRecurso\([^,]+,\s*"([a-z_]+)"/g)) achados.add(m[1]!);
  return [...achados];
}

const todas = rotas(API)
  .map((arquivo) => ({ arquivo, rel: relDaRota(arquivo) }))
  .filter(({ rel }) => !FORA.has(rel.split("/")[0]!));

describe("rotas /api/v1 × recurso do plano", () => {
  it("a varredura acha rotas (guarda de vacuidade)", () => {
    expect(todas.length).toBeGreaterThan(100);
  });

  it("toda família fora de FORA está declarada no mapa — nunca 'liberado por omissão'", () => {
    const semFamilia = todas.filter(({ rel }) => recursoDaRota(rel) === undefined).map(({ rel }) => rel);
    expect(semFamilia, "declare a família em lib/entitlements/rotas.ts (null se for do produto)").toEqual([]);
  });

  it("toda entrada de DELEGADAS aponta para rota que existe, e o guarda existe", () => {
    const existentes = new Set(todas.map(({ rel }) => rel));
    for (const [rel, { guarda }] of Object.entries(DELEGADAS)) {
      expect(existentes.has(rel), `${rel} não existe mais — tire da allowlist`).toBe(true);
      if (guarda) expect(statSync(join(API, guarda)).isFile(), `${guarda} não existe`).toBe(true);
    }
  });

  it("rota vendável declara o recurso do mapa; rota do produto não declara nenhum", () => {
    const problemas: string[] = [];
    for (const { arquivo, rel } of todas) {
      const esperado = recursoDaRota(rel);
      const delegada = DELEGADAS[rel];
      const fonte = readFileSync(delegada?.guarda ? join(API, delegada.guarda) : arquivo, "utf8");
      const declarados = recursosDeclarados(fonte);

      if (esperado === null) {
        if (declarados.length > 0) problemas.push(`${rel}: rota do produto declara feature ${declarados.join(",")}`);
        continue;
      }
      if (delegada && delegada.guarda === null) continue;
      if (!declarados.includes(esperado!)) {
        problemas.push(`${rel}: exige "${esperado}" e declara ${declarados.length ? declarados.join(",") : "NADA"}`);
      }
      const estranhos = declarados.filter((d) => d !== esperado);
      if (estranhos.length) problemas.push(`${rel}: declara ${estranhos.join(",")} além de "${esperado}"`);
    }
    expect(problemas).toEqual([]);
  });

  it("todo recurso declarado nas rotas existe no vocabulário", () => {
    const desconhecidos: string[] = [];
    for (const { arquivo, rel } of todas) {
      for (const d of recursosDeclarados(readFileSync(arquivo, "utf8"))) {
        if (!(RECURSOS as readonly string[]).includes(d)) desconhecidos.push(`${rel}: ${d}`);
      }
    }
    expect(desconhecidos).toEqual([]);
  });

  it("o instrumento enxerga a violação (controle negativo)", () => {
    expect(recursosDeclarados('requireRole("agent", { feature: "crm", requestId })')).toEqual(["crm"]);
    expect(recursosDeclarados('await recusaPorRecurso(org.id, "inbox", { requestId })')).toEqual(["inbox"]);
    expect(recursosDeclarados('requireRole("agent", { requestId })')).toEqual([]);
  });
});
