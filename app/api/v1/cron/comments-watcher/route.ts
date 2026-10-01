/**
 * NENHUM COMENTÁRIO SEM RESPOSTA (spec 22 §8) — a rodada que fecha o laço.
 *
 * Duas coisas, nesta ordem:
 *
 *   1. CONFERIR (`lib/channels/comentarios/conferencia.ts`): o que o webhook
 *      não entregou nas últimas horas entra pela mesma ingestão. Primeiro,
 *      porque o comentário recuperado agora precisa entrar na conta do aviso.
 *   2. VIGIAR (`lib/channels/comentarios/vigia.ts`): comentário aberto há mais
 *      que o prazo da organização vira aviso na Central, um por conta — e o
 *      aviso fecha sozinho quando a fila da conta zera.
 *
 * De 15 em 15 minutos: o prazo é de horas, e a conferência olha as últimas 3 h
 * com folga para duas rodadas perdidas.
 *
 * Rodada que não recuperou nem avisou nada NÃO é mutação e não audita
 * (CLAUDE.md §Audit log, `cron-audita-so-quando-ha-efeito.test.ts`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { conferirComentarios } from "@/lib/channels/comentarios/conferencia";
import { vigiarComentariosParados } from "@/lib/channels/comentarios/vigia";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const fornecido = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (aceitos.length === 0 || !fornecido || !aceitos.includes(fornecido)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  // A conferência fala com a rede; falhar nela não pode calar o aviso.
  const conferencia = await conferirComentarios(admin).catch((err: unknown) => {
    logger.error("[comments-watcher] conferência falhou", {
      requestId,
      detail: err instanceof Error ? err.message.slice(0, 160) : "unknown",
    });
    return { contas: 0, recuperados: 0, falhas: 1 };
  });

  let vigia;
  try {
    vigia = await vigiarComentariosParados(admin);
  } catch (err) {
    logger.error("[comments-watcher] vigia falhou", {
      requestId,
      detail: err instanceof Error ? err.message.slice(0, 160) : "unknown",
    });
    return fail("internal_error", "Falha ao vigiar comentários.", 500, { requestId });
  }

  const houveEfeito =
    conferencia.recuperados > 0 || vigia.avisosAbertos > 0 || vigia.avisosAtualizados > 0 || vigia.avisosFechados > 0;
  if (houveEfeito) {
    await audit({
      action: "channel.comments_watched",
      resourceType: "conversation",
      requestId,
      metadata: { conferencia, vigia },
    });
  }

  return ok({ conferencia, vigia }, { requestId });
}

export const GET = handle;
export const POST = handle;
