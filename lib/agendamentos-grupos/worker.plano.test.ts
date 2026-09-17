/**
 * O worker de Disparo respeita o plano (migration 0275): uma organização sem
 * `broadcast` tem a ocorrência registrada como `skipped` com
 * `feature_not_entitled` — visível no Histórico —, o relógio do agendamento
 * avança (senão a mesma ocorrência voltaria a cada minuto), e a Central recebe
 * o aviso. Nenhuma chamada ao adapter de envio acontece.
 *
 * O admin client é um fake por PROXY: todo método devolve o mesmo builder, que
 * registra as chamadas e resolve pelo `responder(tabela, ops)`. É o mínimo para
 * atravessar o worker até o gate sem reproduzir o Supabase.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels", () => ({ getAdapter: vi.fn(() => { throw new Error("o adapter NÃO devia ser chamado"); }) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { executarAgendamentosDeGrupo } = await import("./worker");

const ORG = "22222222-2222-4222-8222-222222222222";

interface Op { m: string; args: unknown[] }
interface Chamada { tabela: string; ops: Op[] }

function fakeAdmin(responder: (tabela: string, ops: Op[]) => unknown, rpc: (fn: string, args: unknown) => unknown) {
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
  return { admin: { from: builder, rpc: vi.fn(async (fn: string, args: unknown) => rpc(fn, args)) }, chamadas };
}

const AGENDAMENTO = {
  id: "a1",
  organization_id: ORG,
  channel_session_id: "cs1",
  group_id: "g1",
  body: "oi",
  metadata: {},
  next_run_at: "2026-09-17T12:00:00.000Z",
  recurrence_kind: "none",
  recurrence_config: {},
  repeat_until: null,
  max_runs: null,
  scheduled_whatsapp_groups: { external_group_id: "x@g.us", is_active: true },
  channel_sessions: { id: "cs1", organization_id: ORG, status: "WORKING", archived_at: null, provider: "waha", session_name: "s" },
};

function responderPadrao(tabela: string, ops: Op[]): unknown {
  const nomes = ops.map((o) => o.m);
  if (tabela === "scheduled_group_messages" && nomes[0] === "select") return { data: [AGENDAMENTO], error: null };
  if (tabela === "scheduled_group_message_runs" && nomes.includes("maybeSingle")) return { data: null, error: null };
  if (tabela === "scheduled_group_message_runs" && nomes[0] === "insert") return { data: { id: "run1" }, error: null };
  if (tabela === "scheduled_group_message_runs" && nomes[0] === "select") return { count: 0, error: null };
  if (tabela === "agent_inbox_items" && nomes[0] === "select") return { count: 0, error: null };
  return { data: null, error: null, count: 0 };
}

describe("worker de Disparo × plano", () => {
  it("sem broadcast: run skipped com feature_not_entitled, relógio avança, Central avisada, adapter intocado", async () => {
    const { admin, chamadas } = fakeAdmin(responderPadrao, () => ({ data: false, error: null }));
    const r = await executarAgendamentosDeGrupo(admin as never, new Date("2026-09-17T12:01:00Z"), "req-1");

    expect(r).toMatchObject({ scanned: 1, claimed: 1, sent: 0, failed: 0, skipped: 1 });
    expect(admin.rpc).toHaveBeenCalledWith("fn_org_has_feature", { p_org: ORG, p_feature: "broadcast" });

    const finalizacao = chamadas.find(
      (c) => c.tabela === "scheduled_group_message_runs" && c.ops[0]?.m === "update" &&
        (c.ops[0].args[0] as { error_code?: string }).error_code === "feature_not_entitled",
    );
    expect(finalizacao, "a run foi finalizada com o motivo").toBeTruthy();
    expect((finalizacao!.ops[0]!.args[0] as { status: string }).status).toBe("skipped");

    const avanco = chamadas.find(
      (c) => c.tabela === "scheduled_group_messages" && c.ops[0]?.m === "update" &&
        "next_run_at" in (c.ops[0].args[0] as object),
    );
    expect(avanco, "o relógio do agendamento avançou").toBeTruthy();

    // O aviso é fire-and-forget (`void`): dá um tick para ele terminar.
    await new Promise((r) => setTimeout(r, 0));
    expect(chamadas.some((c) => c.tabela === "agent_inbox_items" && c.ops[0]?.m === "insert")).toBe(true);
  });

  it("consulta do plano falhando NÃO pula: o worker segue para o envio (e cai no adapter, que aqui explode de propósito)", async () => {
    const { admin } = fakeAdmin(responderPadrao, () => { throw new Error("banco fora"); });
    // O rpc do fake vira `{ error }` como o Supabase faria.
    admin.rpc = vi.fn(async () => ({ data: null, error: { message: "banco fora" } })) as never;
    const r = await executarAgendamentosDeGrupo(admin as never, new Date("2026-09-17T12:01:00Z"), "req-2");
    // Chegou ao adapter (mockado para explodir) → a run vira failed, não skipped.
    expect(r.skipped).toBe(0);
    expect(r.failed).toBe(1);
  });
});
