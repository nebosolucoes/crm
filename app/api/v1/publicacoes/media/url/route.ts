/**
 * GET /api/v1/publicacoes/media/url?storage_path= — URL assinada e curta para
 * a tela mostrar a miniatura. Só caminhos do prefixo desta organização; o
 * bucket é privado e a URL vale 10 minutos.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { isPublicationMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import { VALIDADE_DA_URL_ASSINADA_S } from "@/lib/publicacoes/politica";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z.object({ storage_path: z.string().trim().min(1).max(500) });

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { feature: "broadcast", requestId, resource: "publication_media" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  if (!isPublicationMediaPathOwnedBy(parsed.data.storage_path, authz.org.orgId)) {
    return fail("not_found", t("Arquivo não encontrado."), 404, { requestId });
  }
  const { data, error } = await createAdminClient()
    .storage.from("whatsapp-media")
    .createSignedUrl(parsed.data.storage_path, VALIDADE_DA_URL_ASSINADA_S);
  if (error || !data?.signedUrl) return fail("not_found", t("Arquivo não encontrado."), 404, { requestId });
  return ok({ url: data.signedUrl, expires_in: VALIDADE_DA_URL_ASSINADA_S }, { requestId });
}
