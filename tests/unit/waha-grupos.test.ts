import { afterEach, describe, expect, it, vi } from "vitest";

import { WahaClient } from "@/lib/waha/client";

describe("consulta de grupos da conexão", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("consulta a sessão selecionada e normaliza o retorno do transporte", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: { _serialized: "120@g.us" }, subject: "Grupo VIP" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const grupos = await new WahaClient("https://waha.test", "secret").getGroups("sessao-escolhida");

    expect(grupos).toEqual([{ id: "120@g.us", name: "Grupo VIP", groupKind: "group", participantCount: null }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://waha.test/api/sessao-escolhida/groups?limit=100&offset=0&sortBy=subject&sortOrder=asc&exclude=participants",
      expect.objectContaining({ headers: { "X-Api-Key": "secret", Accept: "application/json" } }),
    );
  });

  it("busca páginas adicionais quando a conexão tem mais de 100 grupos", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const offset = new URL(input).searchParams.get("offset");
      const groups = offset === "0"
        ? Array.from({ length: 100 }, (_, index) => ({ id: `${index}@g.us`, subject: `Grupo ${index}` }))
        : [{ id: "100@g.us", subject: "Grupo 100" }];
      return new Response(JSON.stringify(groups), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const grupos = await new WahaClient("https://waha.test", "secret").getGroups("sessao");

    expect(grupos).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("offset=100");
  });

  it("aceita envelopes de resposta usados por engines diferentes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: { user: "120", server: "g.us" }, title: "Grupo envelope" }] }), {
          status: 200,
        }),
      ),
    );

    const grupos = await new WahaClient("https://waha.test", "secret").getGroups("sessao");

    expect(grupos).toEqual([{ id: "120@g.us", name: "Grupo envelope", groupKind: "group", participantCount: null }]);
  });

  it("normaliza o mapa indexado por ID retornado pelo NOWEB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ "120@g.us": { subject: "Grupo NOWEB" } }), { status: 200 }),
      ),
    );

    const grupos = await new WahaClient("https://waha.test", "secret").getGroups("sessao");

    expect(grupos).toEqual([{ id: "120@g.us", name: "Grupo NOWEB", groupKind: "group", participantCount: null }]);
  });
});
