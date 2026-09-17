import { beforeEach, describe, expect, it, vi } from "vitest";

const orgTemRecurso = vi.fn(async (_o: string, _r: string) => true);
vi.mock("./resolver", () => ({ orgTemRecurso: (o: string, r: string) => orgTemRecurso(o, r) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { handlerComPlano, MOTIVO_FORA_DO_PLANO } = await import("./handler-com-plano");

const ORG = "22222222-2222-4222-8222-222222222222";
const row = {
  id: "e1",
  organization_id: ORG,
  event_type: "message.received",
  entity_kind: "message",
  entity_id: null,
  payload: {},
  metadata: {},
  created_at: "x",
} as never;

beforeEach(() => {
  orgTemRecurso.mockReset();
  orgTemRecurso.mockResolvedValue(true);
});

describe("handlerComPlano", () => {
  const interno = vi.fn(async () => ({ consumer_key: "h.v1", status: "ok" as const }));
  const h = handlerComPlano({ key: "h.v1", events: ["message.received"], handle: interno }, "ai_agents");

  it("mantém key e events, e com o recurso delega ao handler", async () => {
    interno.mockClear();
    expect(h.key).toBe("h.v1");
    expect(h.events).toEqual(["message.received"]);
    expect(await h.handle(row)).toEqual({ consumer_key: "h.v1", status: "ok" });
    expect(interno).toHaveBeenCalledTimes(1);
  });

  it("sem o recurso: skipped com o motivo, e o handler NÃO roda", async () => {
    interno.mockClear();
    orgTemRecurso.mockResolvedValue(false);
    expect(await h.handle(row)).toEqual({
      consumer_key: "h.v1",
      status: "skipped",
      detail: `${MOTIVO_FORA_DO_PLANO}:ai_agents`,
    });
    expect(interno).not.toHaveBeenCalled();
  });

  it("falha da consulta: o handler roda como sempre", async () => {
    interno.mockClear();
    orgTemRecurso.mockRejectedValue(new Error("boom"));
    expect((await h.handle(row)).status).toBe("ok");
    expect(interno).toHaveBeenCalledTimes(1);
  });
});
