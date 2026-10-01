/**
 * Fecha um atendimento de comentário com o MOTIVO (spec 22 §5.2).
 *
 * Um só caminho para os três jeitos de fechar — respondido pelo CRM,
 * respondido pelo app do celular, fechado sem resposta — para o motivo cair
 * sempre no mesmo lugar (`metadata.comentario.fechamento` e o audit
 * `conversation.closed`), e o aviso de "comentário sem resposta" fechar junto.
 *
 * Usa `fn_service_status`, a mesma transição do botão "Fechar" da inbox: ela
 * trava o contato, sobe a revisão do atendimento e carimba `service_closed_at`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";

import type { MotivoDeFechamentoDeComentario } from "./vocabulario";

const TERMINAIS = new Set(["closed", "resolved", "archived"]);

export async function fecharAtendimentoDeComentario(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    motivo: MotivoDeFechamentoDeComentario;
    /** `null` = o sistema (webhook, envio automático). */
    actorUserId: string | null;
    requestId?: string;
    /** Revisão que a TELA viu; ausente nos fechamentos automáticos. */
    revisaoEsperada?: number | null;
  },
): Promise<{ fechou: boolean; jaEstavaFechada: boolean }> {
  const { data: atual } = await admin
    .from("conversations")
    .select("status, metadata, kind")
    .eq("organization_id", input.organizationId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!atual || atual.kind !== "comment") return { fechou: false, jaEstavaFechada: false };
  if (TERMINAIS.has(atual.status as string)) return { fechou: false, jaEstavaFechada: true };

  const { error } = await admin.rpc("fn_service_status", {
    p_org: input.organizationId,
    p_conversation: input.conversationId,
    p_status: "closed",
    p_expected: input.revisaoEsperada ?? undefined,
  });
  if (error) {
    if (error.code === "40001") throw Object.assign(new Error("service_stale"), { code: "40001" });
    throw new Error(`fechar_comentario: ${error.message}`);
  }

  const meta = (atual.metadata ?? {}) as Record<string, unknown>;
  const comentario = (meta.comentario ?? {}) as Record<string, unknown>;
  const { error: erroMeta } = await admin
    .from("conversations")
    .update({
      metadata: {
        ...meta,
        comentario: { ...comentario, fechamento: { motivo: input.motivo, em: new Date().toISOString() } },
      },
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.conversationId);
  if (erroMeta) logger.warn("[comentarios] motivo do fechamento não gravado", { detail: erroMeta.message });

  // O aviso de "sem resposta" deste fio perde o sentido no instante em que ele fecha.
  await admin
    .from("agent_inbox_items")
    .update({ status: "resolved" })
    .eq("organization_id", input.organizationId)
    .eq("kind", "comment_unanswered")
    .eq("ref_kind", "conversation")
    .eq("ref_id", input.conversationId)
    .eq("status", "open");

  void audit({
    action: "conversation.closed",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    resourceType: "conversation",
    resourceId: input.conversationId,
    requestId: input.requestId,
    metadata: { kind: "comment", motivo: input.motivo },
  });

  return { fechou: true, jaEstavaFechada: false };
}
