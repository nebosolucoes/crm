/**
 * Cliente Supabase FALSO para os testes do worker: grava cada cadeia
 * `.from(tabela).x().y()` e resolve no `await` pelo `responder`. O mesmo
 * padrão que o Disparo usava (`worker.plano.test.ts`), com `rpc` e
 * `storage.from().createSignedUrl()` incluídos.
 *
 * Não é um `*.test.ts`: o Vitest não o executa; os testes ao lado o importam.
 */
import { vi } from "vitest";

export interface Op {
  m: string;
  args: unknown[];
}
export interface Chamada {
  tabela: string;
  ops: Op[];
}

export type Responder = (tabela: string, ops: Op[]) => unknown;
export type Rpc = (fn: string, args: unknown) => unknown;

export function fakeAdmin(responder: Responder, rpc: Rpc = () => ({ data: null, error: null })) {
  const chamadas: Chamada[] = [];
  const builder = (tabela: string) => {
    const ops: Op[] = [];
    const registro: Chamada = { tabela, ops };
    chamadas.push(registro);
    const p: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            const r = responder(tabela, ops);
            return (res: (v: unknown) => void) => res(r);
          }
          return (...args: unknown[]) => {
            ops.push({ m: String(prop), args });
            return p;
          };
        },
      },
    );
    return p;
  };
  const admin = {
    from: builder,
    rpc: vi.fn(async (fn: string, args: unknown) => rpc(fn, args)),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.local/${path}?token=x` }, error: null }),
      }),
    },
  };
  return { admin, chamadas };
}

/** Os nomes dos métodos de uma cadeia, na ordem ("select", "eq", "maybeSingle"…). */
export function nomes(ops: Op[]): string[] {
  return ops.map((o) => o.m);
}

/** O primeiro argumento de um método na cadeia (o objeto de `update`/`insert`, por ex.). */
export function argDe(ops: Op[], metodo: string): unknown {
  return ops.find((o) => o.m === metodo)?.args[0];
}

/** Todas as cadeias de uma tabela cujo primeiro método é `metodo`. */
export function cadeias(chamadas: Chamada[], tabela: string, metodo: string): Chamada[] {
  return chamadas.filter((c) => c.tabela === tabela && c.ops[0]?.m === metodo);
}
