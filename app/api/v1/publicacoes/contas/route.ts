/**
 * GET /api/v1/publicacoes/contas — as contas em que esta organização pode
 * publicar, por rede, com o estado de conexão. É o que o seletor de destinos
 * mostra: rede sem conta aparece desabilitada com o caminho para Conexões.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { contasPublicaveis } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";

import { responderErro } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "channel_sessions" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  try {
    const contas = await contasPublicaveis(createAdminClient(), authz.org.orgId);
    return ok(contas, { requestId });
  } catch (err) {
    return responderErro(err, requestId, t, "contas");
  }
}
