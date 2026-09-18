/**
 * GET  /api/v1/admin/tenants/[id]/overrides — todos os overrides da organização.
 * POST /api/v1/admin/tenants/[id]/overrides — libera ou bloqueia um recurso,
 *      com janela, limites e motivo. Aceita `Idempotency-Key` (24 h).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { criarOverride, visaoDeEntitlements } from "@/lib/entitlements/admin/organizacoes";
import { overrideCriarSchema } from "@/lib/entitlements/admin/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ENDPOINT = "admin.tenants.overrides.create";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requirePlatformAdminApi({ requestId });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const visao = await visaoDeEntitlements(createAdminClient(), id);
  if (!visao) return fail("not_found", "Tenant not found", 404, { requestId });
  return ok(visao.overrides, { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;
  const authz = await requirePlatformAdminApi({ requestId, escrita: true });
  if (!authz.ok) return authz.response;

  const corpo = await req.json().catch(() => null);
  const parsed = overrideCriarSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId, details: parsed.error.flatten() });
  }

  const admin = createAdminClient();
  type Resposta = { data?: { id: string }; error?: { code: string; message: string } };
  const executar = async (): Promise<{ resposta: Resposta; status: number }> => {
    const r = await criarOverride(admin, authz.user.id, id, parsed.data, requestId);
    if (!r.ok) {
      const status = r.codigo === "not_found" ? 404 : r.codigo === "forbidden" ? 403 : r.codigo === "internal_error" ? 500 : 422;
      return { resposta: { error: { code: r.codigo, message: r.mensagem } }, status };
    }
    return { resposta: { data: r.valor }, status: 201 };
  };

  const chave = chaveDaRequisicao(req);
  if (!chave) {
    const { resposta, status } = await executar();
    return Response.json(resposta, { status, headers: { "X-Request-Id": requestId } });
  }
  const desfecho = await comIdempotencia<Resposta>({ db: admin, organizationId: id, endpoint: ENDPOINT, chave, corpo, executar });
  if (desfecho.tipo === "conflito") {
    return fail("idempotency_conflict", "Esta chave de idempotência já foi usada com outro conteúdo.", 409, { requestId });
  }
  return Response.json(desfecho.resposta, { status: desfecho.status, headers: { "X-Request-Id": requestId } });
}
