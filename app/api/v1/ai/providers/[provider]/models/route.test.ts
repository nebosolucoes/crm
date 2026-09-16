import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";

function bancoComModelos(modelos: unknown[]) {
  const consulta = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(resolve({ data: modelos, error: null })),
  };
  return { from: vi.fn(() => consulta) };
}

describe("GET /api/v1/ai/providers/:provider/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAuthUser).mockResolvedValue({ id: "user" } as never);
    vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG_ID } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("busca o catálogo público quando OpenRouter ainda não foi sincronizada", async () => {
    vi.mocked(createClient).mockResolvedValue(bancoComModelos([]) as never);
    const buscar = vi.fn();
    vi.stubGlobal(
      "fetch",
      buscar.mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-4o-mini",
                name: "GPT-4o mini",
                context_length: 128000,
                pricing: { prompt: "0.00000015", completion: "0.0000006" },
                supported_parameters: ["tools"],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ provider: "openrouter" }),
    });
    const body = (await response.json()) as {
      data: { models: Array<{ model_id: string; display_name: string }> };
    };

    expect(response.status).toBe(200);
    expect(buscar).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(body.data.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model_id: "openai/gpt-4o-mini", display_name: "GPT-4o mini" }),
      ]),
    );
  });

  it("preserva o catálogo local e não chama a OpenRouter quando já há modelos", async () => {
    const local = [{ provider: "openrouter", model_id: "anthropic/claude-sonnet-4" }];
    vi.mocked(createClient).mockResolvedValue(bancoComModelos(local) as never);
    const buscar = vi.fn();
    vi.stubGlobal("fetch", buscar);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ provider: "openrouter" }),
    });
    const body = (await response.json()) as { data: { models: unknown[] } };

    expect(response.status).toBe(200);
    expect(body.data.models).toEqual(local);
    expect(buscar).not.toHaveBeenCalled();
  });
});
