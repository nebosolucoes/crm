/** Busca o catálogo público da OpenRouter.
 *
 * O endpoint não exige credencial. A função recebe o fetch para que o cron e a
 * tela possam compartilhar o contrato sem acoplar os testes à rede.
 */
import type { ModeloDaOpenRouter } from "./openrouter";

export const ENDPOINT_DO_CATALOGO_OPENROUTER = "https://openrouter.ai/api/v1/models";
const TIMEOUT_MS = 20_000;

export async function buscarCatalogoOpenRouter(
  fetchImpl: typeof fetch = fetch,
): Promise<ModeloDaOpenRouter[]> {
  const res = await fetchImpl(ENDPOINT_DO_CATALOGO_OPENROUTER, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`catalogo_origem_status_${res.status}`);

  const json = (await res.json()) as { data?: ModeloDaOpenRouter[] };
  if (!Array.isArray(json.data)) {
    throw new Error("catalogo_origem_shape_inesperado — a resposta não trouxe `data` como lista");
  }
  return json.data;
}
