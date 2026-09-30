/**
 * GET  /api/v1/publicacoes — as publicações da organização (rascunhos inclusive),
 *                            por status; a Lista operacional lê `/ocorrencias`.
 * POST /api/v1/publicacoes — criar. Idempotente por `Idempotency-Key` (o
 *                            `apiClient` manda uma por POST): duplo clique em
 *                            "Agendar" não cria duas publicações.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { criarPublicacaoSchema, STATUS_DA_PUBLICACAO } from "@/lib/publicacoes/schema";
import { criarPublicacao } from "@/lib/publicacoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { lerCorpo, responderErro, responderValidacao } from "./_comum";

export const dynamic = "force-dynamic";

const ENDPOINT = "/api/v1/publicacoes";

const filtrosSchema = z.object({
  status: z.enum(STATUS_DA_PUBLICACAO).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "publications" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = filtrosSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);

  const admin = createAdminClient();
  let q = admin
    .from("publications")
    .select("id, title, body, status, timezone, recurrence_kind, recurrence_config, repeat_until, max_occurrences, created_at, updated_at, cancelled_at, cancel_reason")
    .eq("organization_id", authz.org.orgId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(parsed.data.limit);
  if (parsed.data.status) q = q.eq("status", parsed.data.status);
  const { data, error } = await q;
  if (error) return responderErro(new Error(error.message), requestId, t, "listar");
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publications" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = criarPublicacaoSchema.safeParse(await lerCorpo(req));
  if (!parsed.success) return responderValidacao(parsed.error, requestId, t);

  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.string().uuid().safeParse(chave).success) {
    return fail("validation_failed", t("Idempotency-Key deve ser UUID."), 400, { requestId });
  }

  const admin = createAdminClient();
  const criar = async () => {
    const publicacao = await criarPublicacao(admin, { orgId: authz.org.orgId, userId: authz.user.id }, parsed.data);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "publication.created",
      resourceType: "publications",
      resourceId: publicacao.id,
      requestId,
      metadata: {
        status: publicacao.status,
        targets: publicacao.targets.map((d) => `${d.network}/${d.format}`),
        occurrences: publicacao.occurrences.length,
        media_count: publicacao.media.length,
        recurrence: publicacao.recurrence.kind,
      },
    });
    return publicacao;
  };

  try {
    if (chave === null) {
      return ok(await criar(), { requestId, status: 201 });
    }
    const desfecho = await comIdempotencia({
      db: await createClient(),
      organizationId: authz.org.orgId,
      endpoint: ENDPOINT,
      chave,
      corpo: parsed.data,
      executar: async () => ({ resposta: await criar(), status: 201 }),
    });
    if (desfecho.tipo === "conflito") {
      return fail("idempotency_conflict", t("Esta chave de idempotência já foi usada com outro conteúdo."), 409, { requestId });
    }
    return ok(desfecho.resposta, { requestId, status: desfecho.status === 201 ? 201 : 200 });
  } catch (err) {
    return responderErro(err, requestId, t, "criar");
  }
}
