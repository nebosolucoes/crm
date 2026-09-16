/**
 * GET /api/v1/ai/providers/:provider/models
 *
 * Lê do catálogo curado `ai_models` (tabela GLOBAL, RLS read-all).
 * Retorna modelos não-deprecated ordenados por default-first depois preço.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { ehProvedorSuportado } from "@/lib/ai/pontos/provedores";
import { traduzirCatalogo } from "@/lib/ai/catalogo/openrouter";
import { buscarCatalogoOpenRouter } from "@/lib/ai/catalogo/buscar-openrouter";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// A OpenRouter tem catálogo dinâmico. Se a instalação ainda não executou o
// cron, o seletor pode usar a fonte pública até a sincronização persistir as
// linhas com preço e capacidade.

// A lista única (`lib/ai/pontos/provedores.ts`) — não uma quarta cópia. Esta
// rota alimenta o seletor de modelos; com a lista velha, pedir os modelos da
// OpenRouter devolvia "provedor desconhecido" para um provedor que a tela ao
// lado oferecia.

const MODEL_COLUMNS =
  "id, provider, model_id, display_name, description, context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools, is_default_for_provider, deprecated_at, released_at";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { provider } = await ctx.params;

  if (!ehProvedorSuportado(provider)) {
    return fail("not_found", "Provider desconhecido.", 404, { requestId });
  }

  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) {
    return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_models")
    .select(MODEL_COLUMNS)
    .eq("provider", provider)
    .is("deprecated_at", null)
    .order("is_default_for_provider", { ascending: false })
    .order("input_price_per_million_cents", { ascending: true });

  if (error) {
    return fail("internal_error", "Erro ao listar modelos.", 500, { requestId });
  }

  if ((data?.length ?? 0) > 0 || provider !== "openrouter") {
    return ok({ models: data ?? [] }, { requestId });
  }

  try {
    const modelosAoVivo = traduzirCatalogo(await buscarCatalogoOpenRouter()).map((modelo) => ({
      provider: modelo.provider,
      model_id: modelo.model_id,
      display_name: modelo.display_name,
      description: modelo.description,
      context_window: modelo.context_window,
      input_price_per_million_cents: modelo.input_price_per_million_cents,
      output_price_per_million_cents: modelo.output_price_per_million_cents,
      supports_tools: modelo.supports_tools,
      supports_vision: modelo.supports_vision,
      is_default_for_provider: false,
      deprecated_at: null,
      released_at: null,
    }));
    return ok({ models: modelosAoVivo }, { requestId });
  } catch (err) {
    // O catálogo remoto é um enriquecimento da tela. Se estiver indisponível,
    // a resposta continua sendo uma lista vazia e o select não vira erro 500.
    logger.warn("[ai-models] catálogo público da OpenRouter indisponível", {
      request_id: requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return ok({ models: [] }, { requestId });
  }
}
