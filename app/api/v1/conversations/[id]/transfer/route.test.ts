import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /conversations/[id]/transfer — as duas formas (spec 20 §3.4):
 *
 *   - `to_sector_id`: a rota valida o setor (ativo, desta org) e chama a RPC
 *     `fn_conversation_transfer_sector` com o ATOR da sessão, pelo admin client
 *     (a RPC é só service_role); audita `conversation.sector_transferred` e
 *     registra a troca de comando com o nome do setor;
 *   - `to_user_id` continua como era, com uma cerca a mais: agent com setor só
 *     transfere para quem divide um setor com ele. Agent sem setor não é
 *     restringido (comportamento de antes).
 *
 * Os dois campos juntos, ou nenhum, são 422 do schema.
 */
const h = vi.hoisted(() => ({
  guard: vi.fn(),
  apoio: vi.fn(),
  audit: vi.fn(),
  troca: vi.fn(),
  rpcSessao: vi.fn(),
  rpcAdmin: vi.fn(),
  fromAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.guard }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.apoio }));
vi.mock("@/lib/audit", () => ({ audit: h.audit, isServiceRoleConfigured: () => true }));
vi.mock("@/lib/inbox/atividade-de-comando", () => ({ registrarTrocaDeComando: h.troca }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpcSessao }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: h.fromAdmin, rpc: h.rpcAdmin }) }));

import { POST } from "@/app/api/v1/conversations/[id]/transfer/route";

const ORG = "a1a40000-0000-4000-8000-000000000001";
const ANA = "a1a40000-0000-4000-8000-000000000002";
const BRUNO = "a1a40000-0000-4000-8000-000000000003";
const CONV = "a1a40000-0000-4000-8000-000000000004";
const FIN = "a1a40000-0000-4000-8000-000000000005";
const COM = "a1a40000-0000-4000-8000-000000000006";
const CONTATO = "a1a40000-0000-4000-8000-000000000007";

type Linha = Record<string, unknown>;
let setorAtivo = true;
/** Linhas de sector_members (com o embed de sectors) que o banco devolve. */
let membros: Array<{ sector_id: string; user_id: string }> = [];
let papel = "manager";

function conversa(extra: Linha = {}): Linha {
  return { id: CONV, organization_id: ORG, contact_id: CONTATO, assigned_to_user_id: null, sector_id: FIN, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  setorAtivo = true;
  membros = [];
  papel = "manager";
  h.apoio.mockResolvedValue(null);
  h.guard.mockImplementation(async () => ({ ok: true, user: { id: ANA, idioma: "pt-BR" }, org: { orgId: ORG, role: papel } }));
  h.troca.mockResolvedValue(undefined);
  h.rpcAdmin.mockResolvedValue({ data: [conversa({ status: "pending" })], error: null });
  h.rpcSessao.mockImplementation(async (fn: string) => {
    if (fn === "fn_conversation_assign") return { data: [conversa({ assigned_to_user_id: BRUNO })], error: null };
    return { data: null, error: null };
  });
  h.fromAdmin.mockImplementation((tabela: string) => {
    const cadeia = {
      select: () => cadeia,
      eq: () => cadeia,
      in: () => cadeia,
      is: () => cadeia,
      maybeSingle: async () => {
        if (tabela === "sectors") return { data: setorAtivo ? { id: FIN, name: "Financeiro" } : null, error: null };
        if (tabela === "user_organizations") return { data: { role: "agent" }, error: null };
        return { data: null, error: null };
      },
      then: (r: (v: unknown) => unknown) => r({ data: tabela === "sector_members" ? membros : [], error: null }),
    };
    return cadeia;
  });
});

const post = (corpo: unknown) =>
  POST(new NextRequest(`https://crm.exemplo/api/v1/conversations/${CONV}/transfer`, { method: "POST", body: JSON.stringify(corpo) }), {
    params: Promise.resolve({ id: CONV }),
  });

describe("para um setor", () => {
  it("chama a RPC com o ator da sessão, audita e registra a troca de comando com o nome do setor", async () => {
    const res = await post({ to_sector_id: FIN, reason: "é cobrança" });
    expect(res.status).toBe(200);
    expect(h.rpcAdmin).toHaveBeenCalledWith("fn_conversation_transfer_sector", {
      p_org: ORG, p_conversation: CONV, p_to_sector: FIN, p_actor: ANA,
    });
    expect(h.rpcSessao).not.toHaveBeenCalledWith("fn_conversation_assign", expect.anything());
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "conversation.sector_transferred", resourceId: CONV, metadata: { to_sector_id: FIN, note: "é cobrança" },
    }));
    expect(h.troca).toHaveBeenCalledWith(expect.objectContaining({
      tipo: "conversation_sector_transferred",
      motivo: "Transferiu a conversa para o setor Financeiro: é cobrança",
      contactId: CONTATO,
    }));
  });

  it("setor inativo ou de outra organização é 422, sem RPC", async () => {
    setorAtivo = false;
    expect((await post({ to_sector_id: FIN })).status).toBe(422);
    expect(h.rpcAdmin).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("a recusa da RPC vira 403 (não vê a conversa) ou 409 (encerrada)", async () => {
    h.rpcAdmin.mockResolvedValueOnce({ data: null, error: { message: "sector_transfer_forbidden" } });
    expect((await post({ to_sector_id: FIN })).status).toBe(403);
    h.rpcAdmin.mockResolvedValueOnce({ data: null, error: { message: "conversation_not_open" } });
    expect((await post({ to_sector_id: FIN })).status).toBe(409);
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe("para uma pessoa", () => {
  it("segue pela RPC de atribuição da sessão, como antes", async () => {
    const res = await post({ to_user_id: BRUNO });
    expect(res.status).toBe(200);
    expect(h.rpcSessao).toHaveBeenCalledWith("fn_conversation_assign", expect.objectContaining({ p_to_user_id: BRUNO, p_reason: "transfer" }));
    expect(h.rpcAdmin).not.toHaveBeenCalled();
  });

  it("agent com setor só transfere para quem divide um setor com ele", async () => {
    papel = "agent";
    membros = [{ sector_id: FIN, user_id: ANA }, { sector_id: COM, user_id: BRUNO }];
    const res = await post({ to_user_id: BRUNO });
    expect(res.status).toBe(422);
    expect(h.rpcSessao).not.toHaveBeenCalledWith("fn_conversation_assign", expect.anything());

    membros = [{ sector_id: FIN, user_id: ANA }, { sector_id: FIN, user_id: BRUNO }];
    expect((await post({ to_user_id: BRUNO })).status).toBe(200);
  });

  it("agent sem setor nenhum não é restringido; manager nunca é", async () => {
    papel = "agent";
    membros = [{ sector_id: COM, user_id: BRUNO }];
    expect((await post({ to_user_id: BRUNO })).status).toBe(200);
    papel = "manager";
    membros = [{ sector_id: FIN, user_id: ANA }, { sector_id: COM, user_id: BRUNO }];
    expect((await post({ to_user_id: BRUNO })).status).toBe(200);
  });
});

describe("schema", () => {
  it("os dois destinos juntos, ou nenhum, são 422", async () => {
    expect((await post({ to_user_id: BRUNO, to_sector_id: FIN })).status).toBe(422);
    expect((await post({ reason: "x" })).status).toBe(422);
    expect(h.rpcAdmin).not.toHaveBeenCalled();
    expect(h.rpcSessao).not.toHaveBeenCalled();
  });
});
