/**
 * POST /api/v1/publicacoes/media — sobe UM arquivo (multipart `file`) para o
 * bucket privado `whatsapp-media`, sob `<org>/publications/<publication_id|novo>/`.
 * Devolve o descritor que a tela guarda e manda em `media[]` ao criar/editar.
 *
 * `publication_id` é opcional (a tela sobe antes de salvar). Dimensão e
 * duração vêm como campos do form, lidos no navegador — dicas, não verdade.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { extFromMime, MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const dica = z.coerce.number().int().positive().optional();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { feature: "broadcast", requestId, resource: "publication_media" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_MEDIA_BYTES + 1_048_576) {
    return fail("payload_too_large", t("Arquivo acima de 50MB."), 413, { requestId });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", t("Campo 'file' (multipart) obrigatório."), 422, { requestId });
  }
  const mime = file.type || "application/octet-stream";
  const verdict = validateOutboundMedia(mime, file.size);
  if (!verdict.ok) {
    const status = verdict.code === "payload_too_large" ? 413 : verdict.code === "unsupported_media_type" ? 415 : 422;
    return fail(verdict.code, t(verdict.message), status, { requestId });
  }
  const publicationId = z.string().uuid().safeParse(form?.get("publication_id")).data ?? "nova";
  const width = dica.safeParse(form?.get("width") ?? undefined).data ?? null;
  const height = dica.safeParse(form?.get("height") ?? undefined).data ?? null;
  const durationMs = dica.safeParse(form?.get("duration_ms") ?? undefined).data ?? null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const storagePath = `${authz.org.orgId}/publications/${publicationId}/${randomUUID()}.${extFromMime(mime)}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("whatsapp-media")
    .upload(storagePath, bytes, { contentType: mime, upsert: false });
  if (error) {
    return fail("internal_error", t("Erro ao subir o arquivo."), 500, { requestId });
  }
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "publication.media_uploaded",
    resourceType: "publication_media",
    resourceId: null,
    requestId,
    metadata: { kind: verdict.kind, size_bytes: bytes.length, publication_id: publicationId === "nova" ? null : publicationId },
  });
  return ok(
    {
      media: {
        kind: verdict.kind,
        storage_path: storagePath,
        mime,
        size_bytes: bytes.length,
        filename: file.name.trim().slice(0, 255) || null,
        width,
        height,
        duration_ms: durationMs,
      },
    },
    { requestId, status: 201 },
  );
}
