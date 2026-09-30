/**
 * O laço de retorno de Publicações (invariante 7 do Sistema Vivo): quando um
 * destino falha de vez, alguém fica sabendo — na Central, com o caminho para
 * a ocorrência no Histórico, onde está o motivo e o botão de reenviar.
 *
 * Um aviso por ocorrência enquanto ele estiver aberto; erro transitório não
 * avisa (o worker ainda vai tentar). Kind `publication_failed` (0283).
 */
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface AvisoDeFalha {
  organizationId: string;
  occurrenceId: string;
  titulo: string | null;
  quando: string;
  /** "Instagram · Stories", "WhatsApp · Ofertas VIP" */
  destino: string;
  motivo: string;
  severity?: "warn" | "critical";
}

export async function avisarFalhaDePublicacao(admin: AdminClient, aviso: AvisoDeFalha): Promise<boolean> {
  try {
    const { count } = await admin
      .from("agent_inbox_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", aviso.organizationId)
      .eq("kind", "publication_failed")
      .eq("ref_kind", "publication_occurrence")
      .eq("ref_id", aviso.occurrenceId)
      .eq("status", "open");
    if ((count ?? 0) > 0) return false;
    const nome = aviso.titulo?.trim() || "Publicação sem título";
    const { error } = await admin.from("agent_inbox_items").insert({
      organization_id: aviso.organizationId,
      kind: "publication_failed",
      severity: aviso.severity ?? "warn",
      title: `"${nome}" não saiu em ${aviso.destino}`,
      body: `${aviso.motivo} A ocorrência é a de ${aviso.quando}. Abra o Histórico de Publicações para ver cada destino e, se fizer sentido, reenviar.`,
      ref_kind: "publication_occurrence",
      ref_id: aviso.occurrenceId,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    logger.warn("[publicacoes] aviso na Central falhou", {
      organization_id: aviso.organizationId,
      occurrence_id: aviso.occurrenceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function rotuloDaRede(network: string): string {
  switch (network) {
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "whatsapp":
      return "WhatsApp";
    default:
      return network;
  }
}

export function rotuloDoFormato(format: string): string {
  switch (format) {
    case "feed":
      return "Feed";
    case "story":
      return "Stories";
    case "reel":
      return "Reels";
    case "group_message":
      return "grupos";
    default:
      return format;
  }
}
