import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * A AGENDA NÃO PEDE A ROTA DE GERENTE.
 *
 * Produção, 03/11/2026: um atendente abriu a agenda e levou 403 `forbidden_role`
 * de `/api/v1/team` (que exige gerente e devolve e-mail). A barra de pessoas
 * ficava vazia e um aviso de erro aparecia. A fonte agora é a lista mínima de
 * atendentes, `/api/v1/team/assignable`.
 */

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { usePessoasDaAgenda } from "@/hooks/agenda/usePessoasDaAgenda";

function embrulho({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("usePessoasDaAgenda", () => {
  it("lê /api/v1/team/assignable e devolve cada pessoa com nome e trilha distinta", async () => {
    get.mockResolvedValue({
      data: [
        { user_id: "u-1", full_name: "Ana", role: "agent", pode_receber: true },
        { user_id: "u-2", full_name: null, role: "manager", pode_receber: true },
      ],
    });
    const { result } = renderHook(() => usePessoasDaAgenda(), { wrapper: embrulho });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(get).toHaveBeenCalledWith("/api/v1/team/assignable");
    expect(get).not.toHaveBeenCalledWith("/api/v1/team");
    expect(result.current.data?.map((p) => [p.id, p.nome])).toEqual([
      ["u-1", "Ana"],
      ["u-2", "Sem nome"],
    ]);
    const [a, b] = result.current.data ?? [];
    expect(a?.trilha).not.toBe(b?.trilha);
  });
});
