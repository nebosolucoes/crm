import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/transfer — reatribui a conversa a outro
 * atendente. Decisão G1-06d (spec 13 §5): transferência é IMEDIATA, sem etapa
 * de aceite do destino.
 *
 * G3-01: a mudança de dono acontece via rpc `fn_conversation_assign`
 * (migration 0031) — UPDATE de assigned_to_user_id + INSERT do evento
 * `reason='transfer'` em `conversation_assignment_events` na MESMA transação,
 * com `unread_count_for_assignee` re-zerado pro novo dono.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { transferConversationSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Conversation } from "@/lib/types/messaging";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { feature: "inbox", requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const user = authz.user;
  const orgId = authz.org.orgId; // fonte confiável (cookie validado), nunca o body

  let input;
  try {
    input = await validateRequest(transferConversationSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  // ── Para um SETOR (spec 20 §3.4) ─────────────────────────────────────────
  if (input.to_sector_id) {
    return transferirParaSetor({
      supabase, requestId, t, user, orgId, role: authz.org.role,
      conversationId: id, toSectorId: input.to_sector_id, reason: input.reason,
    });
  }
  const toUserId = input.to_user_id;
  if (!toUserId) {
    return fail("validation_failed", t("Informe a pessoa ou o setor de destino."), 422, { requestId });
  }

  // Destino tem que ser membro ativo agent+ da MESMA org (a RLS de
  // user_organizations só mostra o próprio membership a um agent — por isso o
  // admin client, filtrado pela org resolvida acima).
  if (isServiceRoleConfigured()) {
    const admin = createAdminClient();
    const { data: member, error: memberErr } = await admin
      .from("user_organizations")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", toUserId)
      .is("revoked_at", null)
      .maybeSingle();
    if (memberErr) {
      return fail("internal_error", memberErr.message, 500, { requestId });
    }
    if (!member || member.role === "viewer") {
      return fail("unprocessable_entity", t("Destino não é um atendente desta organização."), 422, {
        requestId,
      });
    }
  }

  // O agent só transfere para pessoas dos SEUS setores (spec 20 §3.4). Sem setor
  // nenhum na organização, ou sem setor para o agent, vale o comportamento antigo.
  if (authz.org.role === "agent" && isServiceRoleConfigured()) {
    const recusa = await recusaForaDosMeusSetores(createAdminClient(), orgId, user.id, toUserId);
    if (recusa) {
      return fail("unprocessable_entity", t("Você só pode transferir para pessoas dos seus setores."), 422, {
        requestId, details: { to_user_id: toUserId },
      });
    }
  }

  const { data, error } = await supabase.rpc("fn_conversation_assign", {
    p_organization_id: orgId,
    p_conversation_id: id,
    p_to_user_id: toUserId,
    p_reason: "transfer",
    // Imediata (G1-06d): sem optimistic lock — reatribui qualquer que seja o dono atual.
    p_enforce_expected: false,
  });

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }
  const row = data?.[0];
  if (!row) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }

  const conv = row as unknown as Conversation;

  await audit({
    action: "conversation.transferred",
    actorUserId: user.id,
    organizationId: conv.organization_id,
    resourceType: "conversation",
    resourceId: conv.id,
    requestId,
    metadata: {
      to_user_id: toUserId,
      ...(input.reason ? { note: input.reason } : {}),
    },
  });

  // Notificação ao destino (G1-06d): evento no bus; worker/Realtime consome.
  await supabase
    .rpc("emit_event", {
      p_event_type: "conversation.transferred",
      p_entity_kind: "conversation",
      p_entity_id: conv.id,
      p_payload: { assigned_to_user_id: toUserId, transferred_by: user.id },
      p_metadata: { request_id: requestId },
      p_organization_id: conv.organization_id,
    })
    .then(({ error: emitErr }) => {
      if (emitErr) console.error("[conversation.transfer] emit_event failed", emitErr.message);
    });

  // O motivo que a pessoa escreveu ao transferir chega à TELA por aqui. Antes ele
  // ia só para `metadata` do audit log, cuja policy exige `admin` — ou seja,
  // sumia justamente para quem vai continuar o atendimento. O `reason` da
  // atividade é coberto pela cascata de anonimização da LGPD, que é o que
  // permite texto escrito por humano sobre um cliente morar ali.
  await registrarTrocaDeComando({
    supabase,
    organizationId: conv.organization_id,
    conversationId: conv.id,
    contactId: conv.contact_id,
    tipo: "conversation_transferred",
    actor: { type: "user", id: user.id, role: authz.org.role },
    // Canônico em português: quem traduz é a LEITURA (`t(item.reason)`). Ver o
    // bloco "vocabulario de dominio persistido" em `lib/i18n/dicionario.ts`.
    motivo: input.reason?.trim()
      ? `Transferiu a conversa: ${input.reason.trim()}`
      : "Transferiu a conversa para outro atendente",
    payload: { to_user_id: toUserId },
  });

  return ok(conv, { requestId });
}

interface TransferenciaParaSetor {
  supabase: Awaited<ReturnType<typeof createClient>>;
  requestId: string;
  t: (texto: string) => string;
  user: { id: string };
  orgId: string;
  role: string;
  conversationId: string;
  toSectorId: string;
  reason: string | undefined;
}

/**
 * A RPC `fn_conversation_transfer_sector` é só service_role e recebe o ATOR: a
 * sessão já foi validada acima (papel, suporte); a função revalida papel e
 * visibilidade no banco antes de mexer. Numa transação: setor novo, sem dono,
 * `pending`, bastão com quem era dono, evento `sector_transfer`, roteamento
 * reaberto dentro do setor novo.
 */
async function transferirParaSetor(p: TransferenciaParaSetor): Promise<Response> {
  const { supabase, requestId, t, user, orgId, conversationId, toSectorId } = p;
  if (!isServiceRoleConfigured()) {
    return fail("internal_error", "service_role_missing", 500, { requestId });
  }
  const admin = createAdminClient();
  const { data: setor, error: setorErr } = await admin
    .from("sectors")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("id", toSectorId)
    .eq("is_active", true)
    .maybeSingle();
  if (setorErr) return fail("internal_error", setorErr.message, 500, { requestId });
  if (!setor) return fail("unprocessable_entity", t("Setor não encontrado ou inativo."), 422, { requestId });

  const { data, error } = await admin.rpc("fn_conversation_transfer_sector", {
    p_org: orgId,
    p_conversation: conversationId,
    p_to_sector: toSectorId,
    p_actor: user.id,
  });
  if (error) {
    if (error.message.includes("sector_transfer_forbidden")) {
      return fail("forbidden", t("Você não tem acesso a esta conversa."), 403, { requestId });
    }
    if (error.message.includes("conversation_not_open")) {
      return fail("state_conflict", t("Esta conversa já foi encerrada."), 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  const row = (data as unknown as Conversation[] | null)?.[0];
  if (!row) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  await audit({
    action: "conversation.sector_transferred",
    actorUserId: user.id,
    organizationId: row.organization_id,
    resourceType: "conversation",
    resourceId: row.id,
    requestId,
    metadata: { to_sector_id: toSectorId, ...(p.reason ? { note: p.reason } : {}) },
  });

  await registrarTrocaDeComando({
    supabase,
    organizationId: row.organization_id,
    conversationId: row.id,
    contactId: row.contact_id,
    tipo: "conversation_sector_transferred",
    actor: { type: "user", id: user.id, role: p.role },
    motivo: p.reason?.trim()
      ? `Transferiu a conversa para o setor ${setor.name}: ${p.reason.trim()}`
      : `Transferiu a conversa para o setor ${setor.name}`,
    payload: { to_sector_id: toSectorId },
  });

  return ok(row, { requestId });
}

/**
 * `true` = o agent está em algum setor e o destino não divide nenhum setor ATIVO
 * com ele. Agent sem setor (organização sem setores, ou ele fora de todos) não
 * é restringido: é o comportamento de antes da spec 20.
 */
async function recusaForaDosMeusSetores(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  actorId: string,
  toUserId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("sector_members")
    .select("sector_id, user_id, sectors!inner(is_active)")
    .eq("organization_id", orgId)
    .in("user_id", [actorId, toUserId])
    .eq("sectors.is_active", true);
  if (error) throw new Error(error.message);
  const meus = new Set<string>();
  const dele = new Set<string>();
  for (const m of (data ?? []) as Array<{ sector_id: string; user_id: string }>) {
    (m.user_id === actorId ? meus : dele).add(m.sector_id);
  }
  if (meus.size === 0) return false;
  return ![...meus].some((s) => dele.has(s));
}
