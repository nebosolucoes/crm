import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { isScheduledMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * URL assinada e CURTA de um arquivo de disparo, para a prévia da tela.
 *
 * Existe porque o bucket é privado e o agendamento guarda só o CAMINHO: quem
 * abre um disparo para editar precisa ver a foto que já está lá, e a tela não
 * tem como assinar nada sozinha. Dez minutos é o mesmo prazo que o worker usa
 * ao enviar; a URL não é persistida em lugar nenhum.
 *
 * O caminho vem da query, e é conferido contra a organização da SESSÃO antes
 * de qualquer chamada ao Storage — a service key assina qualquer coisa, então
 * o prefixo `${org}/scheduled-groups/` é a única cerca.
 */
const consultaSchema = z.object({
  storage_path: z.string().trim().min(1).max(500),
});

const VALIDADE_SEGUNDOS = 600;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    feature: "broadcast",
    requestId,
    resource: "scheduled_group_messages",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = consultaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return fail("validation_failed", t("Parâmetros inválidos."), 422, { requestId });
  }
  if (!isScheduledMediaPathOwnedBy(parsed.data.storage_path, authz.org.orgId)) {
    return fail("validation_failed", t("A mídia não pertence a esta organização."), 422, {
      requestId,
    });
  }

  const { data, error } = await createAdminClient()
    .storage.from("whatsapp-media")
    .createSignedUrl(parsed.data.storage_path, VALIDADE_SEGUNDOS);
  if (error || !data?.signedUrl) {
    return fail("not_found", t("Arquivo não encontrado."), 404, { requestId });
  }

  return ok({ url: data.signedUrl, expires_in: VALIDADE_SEGUNDOS }, { requestId });
}
