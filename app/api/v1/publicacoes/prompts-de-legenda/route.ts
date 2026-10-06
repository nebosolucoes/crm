/**
 * /api/v1/publicacoes/prompts-de-legenda — os prompts de legenda da
 * organização (migration 0286), cada um com as contas que o usam.
 *
 * GET devolve os prompts e o padrão de cada rede (o que vale para conta sem
 * prompt). POST cria um prompt; as contas escolhidas que estavam noutro prompt
 * passam para este — uma conta usa um prompt só.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { criarPromptSchema, INSTRUCAO_PADRAO, type PromptsDaOrganizacao } from "@/lib/publicacoes/legenda/instrucoes";
import { criarPrompt, ErroDePrompt, listarPrompts } from "@/lib/publicacoes/legenda/prompts";

import { lerCorpo, responderErro, responderValidacao } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "publication_caption_prompts" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  try {
    const corpo: PromptsDaOrganizacao = { prompts: await listarPrompts(getRequestPool(), authz.org.orgId), padroes: INSTRUCAO_PADRAO };
    return ok(corpo, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "prompts-de-legenda");
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_caption_prompts" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = criarPromptSchema.safeParse(await lerCorpo(req));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);
  try {
    const prompt = await criarPrompt(getRequestPool(), authz.org.orgId, authz.user.id, parsed.data);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.caption_prompt_created",
      resourceType: "publication_caption_prompts",
      resourceId: prompt.id,
      requestId,
      metadata: { name: prompt.name, contas: prompt.channel_session_ids.length },
    });
    return ok(prompt, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ErroDePrompt) return fail(err.codigo, t(err.message), err.status, { requestId });
    return responderErro(err, requestId, t, "prompts-de-legenda");
  }
}
