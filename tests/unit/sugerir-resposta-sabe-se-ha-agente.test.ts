import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * "SUGERIR RESPOSTA" SABE, ANTES DO CLIQUE, SE HÁ AGENTE.
 *
 * Produção, 03/11/2026: 2 recusas `reply_no_agent` — o botão aparecia ativo num
 * canal sem agente publicado. `GET …/draft-reply?agente=1` responde pela MESMA
 * função que o POST usa para recusar (`loadConversationAgentConfig`).
 */

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: "u-1", idioma: "pt-BR" },
    org: { orgId: "org-1", role: "agent" },
  })),
}));
const conversa = vi.hoisted(() => ({ linha: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: conversa.linha, error: null }),
      };
      return chain;
    },
  }),
}));
const carregar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-engine/agent/agent-config", () => ({ loadConversationAgentConfig: carregar }));
const consulta = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({ query: consulta }) }));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({ requestTurnDeps: vi.fn() }));
vi.mock("@/lib/agent-engine/agent/reply-drafts", () => ({ generateReplyDraft: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { GET } from "@/app/api/v1/conversations/[id]/draft-reply/route";

async function pergunta(query = "?agente=1") {
  const res = await GET(new NextRequest(`http://x/api/v1/conversations/c-1/draft-reply${query}`), {
    params: Promise.resolve({ id: "c-1" }),
  });
  if (!res) throw new Error("a rota não respondeu");
  return (await res.json()) as { data: Record<string, unknown> };
}

describe("GET /draft-reply?agente=1", () => {
  beforeEach(() => {
    carregar.mockReset();
    consulta.mockClear();
    conversa.linha = { id: "c-1", contact_id: "ct-1", channel_session_id: "ch-1" };
  });

  it("sem agente publicado: agente_disponivel = false", async () => {
    carregar.mockResolvedValue(null);
    expect((await pergunta()).data).toEqual({ agente_disponivel: false });
    expect(carregar).toHaveBeenCalledWith(expect.anything(), "org-1", "c-1", "ch-1");
  });

  it("com agente publicado: true", async () => {
    carregar.mockResolvedValue({ agentId: "a-1" });
    expect((await pergunta()).data).toEqual({ agente_disponivel: true });
  });

  it("conversa sem canal: false, sem consultar o agente", async () => {
    conversa.linha = { id: "c-1", contact_id: "ct-1", channel_session_id: null };
    expect((await pergunta()).data).toEqual({ agente_disponivel: false });
    expect(carregar).not.toHaveBeenCalled();
  });

  it("erro ao conferir: true — quem decide continua sendo o POST", async () => {
    carregar.mockRejectedValue(new Error("timeout"));
    expect((await pergunta()).data).toEqual({ agente_disponivel: true });
  });

  it("CONTROLE — sem o parâmetro, a lista de sugestões segue igual e não consulta o agente", async () => {
    const r = await pergunta("");
    expect(r.data).toEqual({ drafts: [] });
    expect(carregar).not.toHaveBeenCalled();
  });
});
