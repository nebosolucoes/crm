/**
 * PATCH/DELETE /api/v1/publicacoes/prompts-de-legenda/{id} — muda nome, texto
 * ou contas de um prompt; ou o apaga (as contas dele voltam ao padrão da rede).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { alterarPromptSchema } from "@/lib/publicacoes/legenda/instrucoes";
import { alterarPrompt, ErroDePrompt, excluirPrompt } from "@/lib/publicacoes/legenda/prompts";

import { lerCorpo, responderErro, responderValidacao } from "../../_comum";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_caption_prompts" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const rota = z.string().uuid().safeParse((await ctx.params).id);
  if (!rota.success) return fail("not_found", t("Prompt não encontrado."), 404, { requestId });
  const promptId = rota.data;
  const parsed = alterarPromptSchema.safeParse(await lerCorpo(req));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);
  try {
    const prompt = await alterarPrompt(getRequestPool(), authz.org.orgId, authz.user.id, promptId, parsed.data);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.caption_prompt_updated",
      resourceType: "publication_caption_prompts",
      resourceId: prompt.id,
      requestId,
      metadata: { campos: Object.keys(parsed.data), contas: prompt.channel_session_ids.length },
    });
    return ok(prompt, { requestId });
  } catch (err) {
    if (err instanceof ErroDePrompt) return fail(err.codigo, t(err.message), err.status, { requestId });
    return responderErro(err, requestId, t, "prompts-de-legenda");
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_caption_prompts" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const rota = z.string().uuid().safeParse((await ctx.params).id);
  if (!rota.success) return fail("not_found", t("Prompt não encontrado."), 404, { requestId });
  const promptId = rota.data;
  try {
    await excluirPrompt(getRequestPool(), authz.org.orgId, promptId);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.caption_prompt_deleted",
      resourceType: "publication_caption_prompts",
      resourceId: promptId,
      requestId,
    });
    return ok({ id: promptId }, { requestId });
  } catch (err) {
    if (err instanceof ErroDePrompt) return fail(err.codigo, t(err.message), err.status, { requestId });
    return responderErro(err, requestId, t, "prompts-de-legenda");
  }
}
