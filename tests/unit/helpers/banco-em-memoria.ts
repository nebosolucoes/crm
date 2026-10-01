/**
 * Banco em memória para testes de módulos que falam PostgREST via
 * supabase-js. Aplica os filtros de verdade (`eq`, `neq`, `in`, `not`, `gte`,
 * `lt`, `is`), `order` e `limit` — um dublê que só registra chamadas afirma que
 * o código PERGUNTOU, não que achou.
 *
 * `unicos` declara índices únicos por tabela; violá-los devolve 23505, como o
 * Postgres. `rpcs` emula funções do banco.
 */
type Linha = Record<string, unknown>;
type Erro = { code?: string; message: string };

export interface BancoEmMemoria {
  tabelas: Record<string, Linha[]>;
  client: never;
}

export function bancoEmMemoria(opcoes: {
  tabelas?: Record<string, Linha[]>;
  unicos?: Record<string, string[][]>;
  rpcs?: Record<string, (args: Record<string, unknown>, tabelas: Record<string, Linha[]>) => { data: unknown; error: Erro | null }>;
} = {}): BancoEmMemoria {
  const tabelas: Record<string, Linha[]> = opcoes.tabelas ?? {};
  let seq = 0;

  function consulta(nome: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let ordem: { col: string; asc: boolean } | null = null;
    let limite = Infinity;
    let modo: "select" | "update" | "insert" = "select";
    let valores: Linha | Linha[] | null = null;
    const linhas = () => (tabelas[nome] ??= []);
    const casadas = () => {
      let r = linhas().filter((l) => filtros.every((f) => f(l)));
      if (ordem) {
        const { col, asc } = ordem;
        r = [...r].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? (asc ? -1 : 1) : asc ? 1 : -1));
      }
      return r.slice(0, limite);
    };
    const resolver = (): { data: unknown; error: Erro | null } => {
      if (modo === "insert" && valores) {
        const novas: Linha[] = (Array.isArray(valores) ? valores : [valores]).map((v) => ({
          id: `${nome}-${++seq}`,
          created_at: new Date().toISOString(),
          status: nome === "agent_inbox_items" ? "open" : undefined,
          ...v,
        }));
        for (const nova of novas) {
          for (const cols of opcoes.unicos?.[nome] ?? []) {
            if (linhas().some((l) => cols.every((c) => l[c] === nova[c]))) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
          }
        }
        linhas().push(...novas);
        return { data: Array.isArray(valores) ? novas : novas[0], error: null };
      }
      if (modo === "update" && valores && !Array.isArray(valores)) {
        const alvo = casadas();
        for (const l of alvo) Object.assign(l, valores);
        return { data: alvo, error: null };
      }
      return { data: casadas(), error: null };
    };
    const lista = (v: unknown) => String(v).replace(/^\(|\)$/g, "").split(",");
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (v: Linha | Linha[]) => ((modo = "insert"), (valores = v), q),
      update: (v: Linha) => ((modo = "update"), (valores = v), q),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), q),
      gte: (c: string, v: string) => (filtros.push((l) => String(l[c] ?? "") >= v), q),
      lt: (c: string, v: string) => (filtros.push((l) => String(l[c] ?? "") < v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      not: (c: string, op: string, v: unknown) => {
        if (op === "is") filtros.push((l) => (l[c] ?? null) !== v);
        else if (op === "in") filtros.push((l) => !lista(v).includes(String(l[c])));
        else filtros.push((l) => l[c] !== v);
        return q;
      },
      order: (c: string, o?: { ascending?: boolean }) => ((ordem = { col: c, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limite = n), q),
      maybeSingle: async () => {
        const r = resolver();
        if (r.error) return r;
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
      },
      single: async () => {
        const r = resolver();
        return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error };
      },
      then: (ok: (v: unknown) => unknown) => ok(resolver()),
    };
    return q;
  }

  const client = {
    from: (t: string) => consulta(t),
    rpc: async (nome: string, args: Record<string, unknown>) =>
      opcoes.rpcs?.[nome]?.(args, tabelas) ?? { data: null, error: null },
  };
  return { tabelas, client: client as never };
}
