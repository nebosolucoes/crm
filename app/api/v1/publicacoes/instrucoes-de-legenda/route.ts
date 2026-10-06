/**
 * /api/v1/publicacoes/instrucoes-de-legenda — o "prompt prévio" de cada rede,
 * usado pelo Sugerir legenda do Agendar (tabela da migration 0286).
 *
 * GET devolve SEMPRE as três redes, com a instrução em vigor (a da organização
 * ou o padrão do produto) e `personalizada`. PUT grava uma rede; texto vazio
 * apaga a linha e a rede volta ao padrão.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { instrucoesEmVigor, salvarInstrucaoSchema } from "@/lib/publicacoes/legenda/instrucoes";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerCorpo, responderErro, responderValidacao } from "../_comum";

export const dynamic = "force-dynamic";

async function lerTodas(orgId: string) {
  const { data, error } = await createAdminClient()
    .from("publication_caption_instructions")
    .select("network, instructions, updated_at")
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  return instrucoesEmVigor(data ?? []);
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "publication_caption_instructions" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  try {
    return ok(await lerTodas(authz.org.orgId), { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "instrucoes-de-legenda");
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_caption_instructions" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = salvarInstrucaoSchema.safeParse(await lerCorpo(req));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);
  const { network } = parsed.data;
  const texto = parsed.data.instructions.trim();
  const orgId = authz.org.orgId;

  try {
    const admin = createAdminClient();
    if (texto) {
      const { error } = await admin
        .from("publication_caption_instructions")
        .upsert({ organization_id: orgId, network, instructions: texto, updated_by: authz.user.id }, { onConflict: "organization_id,network" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("publication_caption_instructions").delete().eq("organization_id", orgId).eq("network", network);
      if (error) throw new Error(error.message);
    }
    await audit({
      organizationId: orgId,
      actorUserId: authz.user.id,
      action: "publication.caption_instructions_updated",
      resourceType: "publication_caption_instructions",
      resourceId: null,
      requestId,
      metadata: { network, restaurou_padrao: !texto, tamanho: texto.length },
    });
    return ok(await lerTodas(orgId), { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "instrucoes-de-legenda");
  }
}
