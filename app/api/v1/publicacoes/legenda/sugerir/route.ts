/**
 * POST /api/v1/publicacoes/legenda/sugerir — o botão Sugerir legenda do Agendar.
 *
 * Recebe a escolha — um prompt da organização (`prompt_id`) ou o padrão de uma
 * rede (`network`) —, os destinos marcados que ela cobre, a ideia (o que já
 * está no campo Legenda) e até 4 imagens JÁ subidas (`storage_path` do prefixo
 * desta organização). Devolve a legenda; quem decide usar é a tela.
 *
 * Custa dinheiro a cada clique, então tem teto por usuário. A chamada passa por
 * `runModelCall` (ponto `legenda_de_publicacao`): fica em IA › Execuções, conta
 * no orçamento e usa o modelo escolhido em IA › Provedores.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/run-model-call";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { loadEnv } from "@/lib/agent-engine/env";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { sugerirLegendaSchema } from "@/lib/publicacoes/legenda/montar-pedido";
import { lerPrompt } from "@/lib/publicacoes/legenda/prompts";
import { chamarModeloDaLegenda, enxergaPeloCatalogo, ErroDaLegenda, sugerirLegenda } from "@/lib/publicacoes/legenda/sugerir";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerCorpo, responderValidacao } from "../../_comum";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TETO_POR_USUARIO = 10;
const JANELA_SEGUNDOS = 60;

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_caption" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = sugerirLegendaSchema.safeParse(await lerCorpo(req));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);

  const limite = await checkRateLimit(`legenda-sugerir:${authz.user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail("rate_limited", t("Muitas sugestões seguidas. Espere um minuto e tente de novo."), 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const orgId = authz.org.orgId;
  const admin = createAdminClient();
  const pool = getRequestPool();
  try {
    const sugestao = await sugerirLegenda(orgId, parsed.data, {
      lerPrompt: (promptId) => lerPrompt(pool, orgId, promptId),
      baixar: async (storagePath) => {
        const { data, error } = await admin.storage.from("whatsapp-media").download(storagePath);
        if (error || !data) return null;
        return { data: new Uint8Array(await data.arrayBuffer()), mime: data.type || "application/octet-stream" };
      },
      chamarModelo: chamarModeloDaLegenda(pool, llmEdgeConfigFromEnv(loadEnv()), orgId),
      enxerga: enxergaPeloCatalogo(pool),
    });
    await audit({
      organizationId: orgId,
      actorUserId: authz.user.id,
      action: "publication.caption_suggested",
      resourceType: "publication_caption",
      resourceId: null,
      requestId,
      // Nunca o texto: a legenda é conteúdo, a auditoria registra o ato.
      metadata: {
        origem: sugestao.origem.tipo === "prompt" ? { tipo: "prompt", prompt_id: sugestao.origem.prompt_id } : sugestao.origem,
        redes: [...new Set(parsed.data.destinos.map((d) => d.network))],
        model: sugestao.model,
        llm_call_id: sugestao.llm_call_id,
        used_images: sugestao.used_images,
      },
    });
    return ok(sugestao, { requestId });
  } catch (err) {
    if (err instanceof ErroDaLegenda) {
      if (err.status >= 500) logger.warn("[publicacoes] sugerir legenda falhou", { requestId, codigo: err.codigo, detalhe: err.detalhe });
      return fail(err.codigo, t(err.message), err.status, { requestId, details: err.detalhe ? { motivo: err.detalhe } : undefined });
    }
    logger.error("[publicacoes] sugerir legenda falhou", { requestId, cause: err instanceof Error ? err.message : String(err) });
    return fail("internal_error", t("Não foi possível sugerir a legenda. Tente de novo."), 500, { requestId });
  }
}
