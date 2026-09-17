import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { capabilitiesOf } from "@/lib/channels/capabilities";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";
import type { ChannelGroup, ChannelProvider } from "@/lib/channels/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/channels";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  channel_session_id: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "scheduled_whatsapp_groups" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = payloadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const { data: session, error: sessionError } = await createAdminClient()
    .from("channel_sessions")
    .select(`id, provider, ${CHANNEL_SESSION_REF_COLUMNS}`)
    .eq("id", parsed.data.channel_session_id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (sessionError || !session)
    return fail("validation_failed", t("Conexão não encontrada."), 422, { requestId });

  const provider = session.provider as ChannelProvider;
  if (capabilitiesOf(provider).groups === "none") {
    return fail(
      "validation_failed",
      t("Esta conexão não oferece consulta de grupos. Selecione outra conexão."),
      422,
      { requestId },
    );
  }

  let groups: ChannelGroup[];
  try {
    const adapter = getAdapter(provider);
    if (!adapter.fetchGroups)
      return fail("validation_failed", t("Esta conexão não oferece consulta de grupos."), 422, {
        requestId,
      });
    const sessionRef = resolveSessionRef(session as ChannelSessionRef);
    groups = await adapter.fetchGroups({ organizationId: authz.org.orgId, sessionRef });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const message =
      reason.includes("_401") || reason.includes("_403")
        ? "O servidor do canal recusou a chave de acesso. Verifique a configuração da conexão."
        : reason.includes("_404")
          ? "A sessão desta conexão não existe no servidor WhatsApp. Reconecte a conta."
          : reason.includes("_422")
            ? "A conexão ainda não está ativa. Aguarde o status ficar conectado e tente novamente."
            : reason.includes("rate-overlimit")
              ? "O canal limitou a consulta de grupos. Aguarde alguns segundos e tente novamente."
              : t("Não foi possível buscar os grupos da conexão.");
    return fail("internal_error", t(message), 502, { requestId });
  }

  return ok({ groups }, { requestId });
}
