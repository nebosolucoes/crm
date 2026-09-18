import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { executarAgendamentosDeGrupo } from "@/lib/agendamentos-grupos/worker";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });

  let result;
  try {
    result = await executarAgendamentosDeGrupo(createAdminClient(), new Date(), requestId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[scheduled-group-messages] worker falhou", { error: detail, requestId });
    return fail("internal_error", "Failed to send scheduled group messages.", 500, { requestId });
  }

  if (result.sent > 0 || result.failed > 0 || result.skipped > 0) {
    void audit({
      action: "scheduled_group.worker_run",
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
