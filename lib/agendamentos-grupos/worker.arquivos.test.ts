/**
 * Um disparo com VÁRIOS arquivos: cada arquivo é uma mensagem, na ordem em
 * que foi anexado, o texto vai como legenda só do último, os ids externos de
 * todos ficam no recibo — e uma falha no meio fecha como `partial_send` sem
 * reenviar o que já saiu.
 *
 * Mesmo fake por PROXY de `worker.plano.test.ts`: todo método devolve o
 * builder, que registra as chamadas e resolve pelo `responder`. O adapter é
 * um espião que devolve um id por chamada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/lib/channels", () => ({
  getAdapter: () => ({
    isConfigured: () => true,
    codes: { notConfigured: "not_configured", sendFailed: "send_failed" },
    send,
  }),
}));
vi.mock("@/lib/channels/session-ref", () => ({
  CHANNEL_SESSION_REF_COLUMNS: "provider, session_name",
  resolveSessionRef: (c: { session_name: string }) => ({ sessionName: c.session_name }),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { executarAgendamentosDeGrupo, relogioDoWorker } = await import("./worker");

const ORG = "22222222-2222-4222-8222-222222222222";

interface Op {
  m: string;
  args: unknown[];
}
interface Chamada {
  tabela: string;
  ops: Op[];
}

function fakeAdmin(responder: (tabela: string, ops: Op[]) => unknown) {
  const chamadas: Chamada[] = [];
  const builder = (tabela: string) => {
    const ops: Op[] = [];
    chamadas.push({ tabela, ops });
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
  const assinadas: string[] = [];
  const admin = {
    from: builder,
    rpc: vi.fn(async () => ({ data: true, error: null })),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          assinadas.push(path);
          return { data: { signedUrl: `https://assinada/${path}` }, error: null };
        },
      }),
    },
  };
  return { admin, chamadas, assinadas };
}

const ARQUIVOS = [
  {
    kind: "image",
    storage_path: `${ORG}/scheduled-groups/out-1.jpg`,
    mime: "image/jpeg",
    size_bytes: 10,
    filename: "1.jpg",
  },
  {
    kind: "document",
    storage_path: `${ORG}/scheduled-groups/out-2.pdf`,
    mime: "application/pdf",
    size_bytes: 20,
    filename: "tabela.pdf",
  },
  {
    kind: "video",
    storage_path: `${ORG}/scheduled-groups/out-3.mp4`,
    mime: "video/mp4",
    size_bytes: 30,
    filename: "3.mp4",
  },
];

const AGENDAMENTO = {
  id: "a1",
  organization_id: ORG,
  channel_session_id: "cs1",
  group_id: "g1",
  body: "Chegou o catálogo!",
  metadata: { scheduled_media_items: ARQUIVOS },
  next_run_at: "2026-09-17T12:00:00.000Z",
  recurrence_kind: "none",
  recurrence_config: {},
  repeat_until: null,
  max_runs: null,
  scheduled_whatsapp_groups: { external_group_id: "x@g.us", is_active: true },
  channel_sessions: {
    id: "cs1",
    organization_id: ORG,
    status: "WORKING",
    archived_at: null,
    provider: "waha",
    session_name: "s",
  },
};

function responderPadrao(tabela: string, ops: Op[]): unknown {
  const nomes = ops.map((o) => o.m);
  if (tabela === "scheduled_group_messages" && nomes[0] === "select")
    return { data: [AGENDAMENTO], error: null };
  if (tabela === "scheduled_group_message_runs" && nomes.includes("maybeSingle"))
    return { data: null, error: null };
  if (tabela === "scheduled_group_message_runs" && nomes[0] === "insert")
    return { data: { id: "run1" }, error: null };
  if (tabela === "scheduled_group_message_runs" && nomes[0] === "select")
    return { count: 0, error: null };
  return { data: null, error: null, count: 0 };
}

/** O update que fecha a run `run1` — e não a varredura de runs presas do início. */
function finalizacaoDaRun(chamadas: Chamada[]) {
  return chamadas
    .filter(
      (c) =>
        c.tabela === "scheduled_group_message_runs" &&
        c.ops[0]?.m === "update" &&
        c.ops.some((o) => o.m === "eq" && o.args[0] === "id" && o.args[1] === "run1"),
    )
    .map((c) => c.ops[0]!.args[0] as Record<string, unknown>)
    .find(
      (patch) => patch.status === "sent" || patch.status === "failed" || patch.status === "skipped",
    );
}

beforeEach(() => {
  send.mockReset();
  relogioDoWorker.esperar = async () => {};
});

describe("worker de Disparo × vários arquivos", () => {
  it("manda um por um, na ordem, com a legenda só no último — e guarda todos os ids", async () => {
    let n = 0;
    send.mockImplementation(async () => ({ externalId: `msg-${++n}` }));
    const { admin, chamadas, assinadas } = fakeAdmin(responderPadrao);
    const esperas: number[] = [];
    relogioDoWorker.esperar = async (ms) => {
      esperas.push(ms);
    };

    const r = await executarAgendamentosDeGrupo(
      admin as never,
      new Date("2026-09-17T12:01:00Z"),
      "req-1",
    );

    expect(r).toMatchObject({ scanned: 1, claimed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(assinadas).toEqual(ARQUIVOS.map((a) => a.storage_path));
    expect(send).toHaveBeenCalledTimes(3);
    const envios = send.mock.calls.map(
      ([e]) => e as { kind: string; body: string; media: { caption: string | null; url: string } },
    );
    expect(envios.map((e) => e.kind)).toEqual(["image", "document", "video"]);
    expect(envios.map((e) => e.media.caption)).toEqual([null, null, "Chegou o catálogo!"]);
    expect(envios.map((e) => e.body)).toEqual(["", "", "Chegou o catálogo!"]);
    expect(envios[0]!.media.url).toContain("out-1.jpg");
    // Pausa anti-rajada só a partir do segundo arquivo.
    expect(esperas).toHaveLength(2);
    expect(esperas.every((ms) => ms >= 1_200 && ms < 2_000)).toBe(true);

    const fim = finalizacaoDaRun(chamadas)!;
    expect(fim.status).toBe("sent");
    expect(fim.external_message_id).toBe("msg-1");
    expect((fim.metadata as { external_message_ids: string[] }).external_message_ids).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
    ]);
  });

  it("falha no segundo arquivo: fecha como partial_send nomeando o arquivo, sem mandar o terceiro nem repetir o primeiro", async () => {
    send
      .mockResolvedValueOnce({ externalId: "msg-1" })
      .mockRejectedValueOnce(new Error("WAHA 500"));
    const { admin, chamadas } = fakeAdmin(responderPadrao);

    const r = await executarAgendamentosDeGrupo(
      admin as never,
      new Date("2026-09-17T12:01:00Z"),
      "req-2",
    );

    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    const fim = finalizacaoDaRun(chamadas)!;
    expect(fim.status).toBe("failed");
    expect(fim.error_code).toBe("partial_send");
    expect(fim.error_message).toContain("Arquivo 2 de 3 (tabela.pdf)");
    expect(fim.error_message).toContain("1 enviado(s)");
    // O relógio do agendamento avança: a mesma ocorrência não volta no minuto seguinte.
    const avanco = chamadas.find(
      (c) =>
        c.tabela === "scheduled_group_messages" &&
        c.ops[0]?.m === "update" &&
        "next_run_at" in (c.ops[0].args[0] as object),
    );
    expect(avanco).toBeTruthy();
  });

  it("um caminho fora da pasta da organização barra o lote INTEIRO antes do primeiro envio", async () => {
    const alheio = {
      ...AGENDAMENTO,
      metadata: {
        scheduled_media_items: [
          ARQUIVOS[0],
          { ...ARQUIVOS[1], storage_path: "outra-org/scheduled-groups/x.pdf" },
        ],
      },
    };
    const { admin, chamadas, assinadas } = fakeAdmin((tabela, ops) =>
      tabela === "scheduled_group_messages" && ops[0]?.m === "select"
        ? { data: [alheio], error: null }
        : responderPadrao(tabela, ops),
    );
    const r = await executarAgendamentosDeGrupo(
      admin as never,
      new Date("2026-09-17T12:01:00Z"),
      "req-3",
    );
    expect(r.failed).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(assinadas).toEqual([]);
    expect(finalizacaoDaRun(chamadas)!.error_code).toBe("media_path_invalid");
  });

  it("sem arquivo: uma mensagem de texto, como sempre foi", async () => {
    send.mockResolvedValueOnce({ externalId: "msg-t" });
    const soTexto = { ...AGENDAMENTO, metadata: {} };
    const { admin, chamadas } = fakeAdmin((tabela, ops) =>
      tabela === "scheduled_group_messages" && ops[0]?.m === "select"
        ? { data: [soTexto], error: null }
        : responderPadrao(tabela, ops),
    );
    const r = await executarAgendamentosDeGrupo(
      admin as never,
      new Date("2026-09-17T12:01:00Z"),
      "req-4",
    );
    expect(r.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as { kind: string }).kind).toBe("text");
    expect(finalizacaoDaRun(chamadas)!.external_message_id).toBe("msg-t");
  });
});
