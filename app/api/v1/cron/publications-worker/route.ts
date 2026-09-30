/**
 * GET|POST /api/v1/cron/publications-worker — o tick de Publicações.
 *
 * Chamado a cada minuto pelo `scheduler` (`docker/scheduler/entrypoint.sh`),
 * pelo relógio de desenvolvimento (`scripts/dev-crons.ts`) e pelo relógio HTTP
 * das instalações sem scheduler (`lib/relogio/tarefas.ts`). Substitui o
 * `scheduled-group-messages` do Disparo (0265), que só falava com grupos.
 *
 * Audita só quando houve efeito (`tests/unit/cron-audita-so-quando-ha-efeito`):
 * uma rodada vazia não é mutação.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { executarWorkerDePublicacoes } from "@/lib/publicacoes/worker";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });

  let result;
  try {
    result = await executarWorkerDePublicacoes(createAdminClient(), new Date(), requestId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[publications-worker] tick falhou", { error: detail, requestId });
    return fail("internal_error", "Failed to run the publications worker.", 500, { requestId });
  }

  if (result.teve_efeito) {
    void audit({
      action: "publication.worker_run",
      organizationId: null,
      bypassedRls: true,
      metadata: result as unknown as Record<string, unknown>,
      requestId,
    });
  }
  return ok(result, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
