import { describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("../index", () => ({
  getAdapter: vi.fn(() => ({
    isConfigured: () => true,
    codes: { notConfigured: "nc", sendFailed: "sf", unknownError: "ue" },
    send,
  })),
}));

const { publicadorDeGrupos, classificarFalhaDeTransporte } = await import("./grupos");

const esperar = vi.fn(async () => {});
const base = {
  organizationId: "org",
  sessionRef: "sess",
  network: "whatsapp" as const,
  format: "group_message" as const,
  settings: {},
  idempotencyKey: "k",
  referencia: "e1",
  to: "1@g.us",
  esperar,
};
const foto = (n: number) => ({ url: `https://s/${n}.jpg`, mime: "image/jpeg", kind: "image" as const, filename: `${n}.jpg` });

describe("publicadorDeGrupos", () => {
  it("texto puro: uma mensagem, id externo devolvido", async () => {
    send.mockReset().mockResolvedValue({ externalId: "id-1" });
    const r = await publicadorDeGrupos("waha").publish({ ...base, caption: "oi", media: [] });
    expect(r).toMatchObject({ estado: "sent", externalId: "id-1" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: "1@g.us", kind: "text", body: "oi" });
  });

  it("arquivos em ordem, legenda só no último, pausa entre eles, progresso registrado a cada arquivo", async () => {
    send.mockReset().mockImplementation(async (env: { media?: { url: string } }) => ({ externalId: `id-${env.media?.url.slice(-5)}` }));
    esperar.mockClear();
    const progresso: number[] = [];
    const r = await publicadorDeGrupos("waha").publish({
      ...base,
      caption: "Coca 2L",
      media: [foto(1), foto(2), foto(3)],
      onProgresso: async (n) => {
        progresso.push(n);
      },
    });
    expect(r.estado).toBe("sent");
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map((c) => (c[0] as { media: { url: string } }).media.url)).toEqual(["https://s/1.jpg", "https://s/2.jpg", "https://s/3.jpg"]);
    expect(send.mock.calls.map((c) => (c[0] as { body: string }).body)).toEqual(["", "", "Coca 2L"]);
    expect((send.mock.calls[2]![0] as { media: { caption: string } }).media.caption).toBe("Coca 2L");
    expect(esperar).toHaveBeenCalledTimes(2);
    expect(progresso).toEqual([1, 2, 3]);
    expect((r as { externalIds: string[] }).externalIds).toHaveLength(3);
  });

  it("falha no 2º arquivo: partial_send PERMANENTE, sentFiles=1, o 3º não é enviado e o 1º não é repetido", async () => {
    send.mockReset().mockResolvedValueOnce({ externalId: "id-1" }).mockRejectedValueOnce(new Error("waha_timeout: x"));
    const r = await publicadorDeGrupos("waha").publish({ ...base, caption: "c", media: [foto(1), foto(2), foto(3)] });
    expect(r).toMatchObject({ estado: "failed", codigo: "partial_send", categoria: "permanente", sentFiles: 1, externalId: "id-1" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("falha no 1º arquivo por timeout é transitória; por recusa é permanente", async () => {
    send.mockReset().mockRejectedValueOnce(new Error("waha_timeout: 30s"));
    const t = await publicadorDeGrupos("waha").publish({ ...base, caption: "c", media: [foto(1)] });
    expect(t).toMatchObject({ estado: "failed", codigo: "send_failed", categoria: "transitorio", sentFiles: 0 });
    send.mockReset().mockRejectedValueOnce(new Error("waha_sendImage_422"));
    const p = await publicadorDeGrupos("waha").publish({ ...base, caption: "c", media: [foto(1)] });
    expect(p).toMatchObject({ estado: "failed", categoria: "permanente" });
  });

  it("transporte que aceita sem devolver id é falha permanente", async () => {
    send.mockReset().mockResolvedValue({ externalId: null });
    const r = await publicadorDeGrupos("waha").publish({ ...base, caption: "oi", media: [] });
    expect(r).toMatchObject({ estado: "failed", codigo: "sf", categoria: "permanente" });
  });

  it("classificarFalhaDeTransporte: só o passageiro é transitório", () => {
    expect(classificarFalhaDeTransporte("waha_timeout: 15s")).toBe("transitorio");
    expect(classificarFalhaDeTransporte("waha_sendText_503")).toBe("transitorio");
    expect(classificarFalhaDeTransporte("waha_sendText_429")).toBe("transitorio");
    expect(classificarFalhaDeTransporte("fetch failed")).toBe("transitorio");
    expect(classificarFalhaDeTransporte("waha_sendImage_400")).toBe("permanente");
    expect(classificarFalhaDeTransporte("waha_not_configured")).toBe("permanente");
  });
});
