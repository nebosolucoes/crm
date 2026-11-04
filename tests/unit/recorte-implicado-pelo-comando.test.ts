/**
 * O recorte em coluna que acompanha todo filtro por `comando_da_conversa` NÃO
 * pode mudar o resultado — só deixar o banco descartar o histórico por índice
 * antes de calcular o comando linha a linha.
 *
 * Por que existe: a aba Fila (padrão da caixa de entrada) filtrava só pelo campo
 * calculado, e o banco varria a organização inteira a cada refetch. Em produção,
 * entre 30/10 e 03/11/2026, foram mais de 2.400 statement timeouts e o pool de
 * conexões esgotado.
 *
 * A prova é exaustiva: todo subconjunto dos quatro comandos do banco × todo fato
 * que decide o comando. Se uma linha tem um comando pedido, ela PRECISA
 * satisfazer o recorte — senão o recorte esconderia conversa da tela. A regra é
 * a TS (`comandoDaConversa`); a igualdade TS ↔ SQL já é provada por
 * `tests/invariants/comando-da-conversa-espelha-o-ts.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  COMANDOS_DO_BANCO,
  type ComandoDoBanco,
  comRecorteDoComando,
  comandoDaConversa,
  recorteImplicadoPeloComando,
} from "@/lib/inbox/comando-da-conversa";

// O domínio do CHECK `conversations_status_check` (supabase/baseline.sql).
const STATUS = ["open", "pending", "resolved", "claimed", "ai_handling", "closed", "archived"];
const AGORA = new Date("2026-11-03T12:00:00Z");
const SILENCIOS = [null, "2026-11-04T00:00:00Z", "2026-11-01T00:00:00Z", "infinity"];

function subconjuntos<T>(xs: readonly T[]): T[][] {
  return xs.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
}

/** O vocabulário do banco: `ninguem` é o balde `automatico` renomeado. */
function comandoNoBanco(quem: string): ComandoDoBanco {
  return (quem === "ninguem" ? "automatico" : quem) as ComandoDoBanco;
}

describe("recorteImplicadoPeloComando", () => {
  const fatos = STATUS.flatMap((status) =>
    [null, "u-dono"].flatMap((assigned_to_user_id) =>
      SILENCIOS.flatMap((bot_silenced_until) =>
        [false, true].flatMap((force_human) =>
          [false, true].flatMap((is_blocked) =>
            [true, false].map((automaticoDaOrg) => ({
              status,
              assigned_to_user_id,
              bot_silenced_until,
              force_human,
              is_blocked,
              automaticoDaOrg,
            })),
          ),
        ),
      ),
    ),
  );

  it("nunca esconde uma linha cujo comando foi pedido (todo subconjunto × todo fato)", () => {
    let linhasAceitas = 0;
    for (const comandos of subconjuntos(COMANDOS_DO_BANCO)) {
      const recorte = recorteImplicadoPeloComando(comandos);
      for (const f of fatos) {
        const quem = comandoNoBanco(comandoDaConversa(f, AGORA).comando.quem);
        if (!comandos.includes(quem)) continue;
        linhasAceitas++;
        if (recorte.semDono) expect(f.assigned_to_user_id, `${comandos}/${quem}`).toBeNull();
        expect(recorte.statusExcluidos, `${comandos}/${quem}/${f.status}`).not.toContain(f.status);
      }
    }
    // Controle contra o teste vazio: o espaço tem de ter sido percorrido.
    expect(linhasAceitas).toBeGreaterThan(1000);
  });

  it("a Fila e o Automático ganham o recorte inteiro (é ele que corta o histórico)", () => {
    for (const comandos of [["aguardando"], ["aguardando", "automatico"], ["automatico"]] as const) {
      const r = recorteImplicadoPeloComando(comandos);
      expect(r.semDono).toBe(true);
      expect([...r.statusExcluidos].sort()).toEqual(["archived", "closed", "resolved"]);
    }
  });

  it("com humano ou encerrada no conjunto, não inventa recorte que esconderia linha", () => {
    expect(recorteImplicadoPeloComando(["humano"])).toEqual({ semDono: false, statusExcluidos: [] });
    expect(recorteImplicadoPeloComando(["encerrada"])).toEqual({ semDono: true, statusExcluidos: [] });
    expect(recorteImplicadoPeloComando([])).toEqual({ semDono: false, statusExcluidos: [] });
  });
});

describe("comRecorteDoComando", () => {
  function gravador() {
    const chamadas: unknown[][] = [];
    const q = {
      is: (...a: unknown[]) => (chamadas.push(["is", ...a]), q),
      not: (...a: unknown[]) => (chamadas.push(["not", ...a]), q),
    };
    return { q, chamadas };
  }

  it("aplica as duas colunas na consulta da Fila", () => {
    const { q, chamadas } = gravador();
    comRecorteDoComando(q, ["aguardando"]);
    expect(chamadas).toEqual([
      ["is", "assigned_to_user_id", null],
      ["not", "status", "in", "(closed,archived,resolved)"],
    ]);
  });

  it("não toca na consulta quando o conjunto inclui humano", () => {
    const { q, chamadas } = gravador();
    comRecorteDoComando(q, ["humano", "aguardando"]);
    expect(chamadas).toEqual([]);
  });
});
