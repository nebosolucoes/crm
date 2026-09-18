/**
 * Envelopa um `EventHandler` do `event_log` com o gate de plano (migration
 * 0275): sem o recurso, o evento é consumido como `skipped` com o motivo — não
 * `error` (que reprocessa) nem `dead` (que alarma): nada quebrou.
 *
 * Falha da consulta NÃO barra: o handler roda como sempre rodou. Mesma decisão
 * do drain e do claim.
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { logger } from "@/lib/logger";

import type { Recurso } from "./recursos";
import { orgTemRecurso } from "./resolver";

export const MOTIVO_FORA_DO_PLANO = "feature_not_entitled";

export function handlerComPlano(handler: EventHandler, recurso: Recurso): EventHandler {
  return {
    key: handler.key,
    events: handler.events,
    async handle(row: EventRow): Promise<HandlerResult> {
      let tem = true;
      try {
        tem = await orgTemRecurso(row.organization_id, recurso);
      } catch (err) {
        logger.warn("[event-log] plano não pôde ser conferido — handler segue", {
          handler: handler.key,
          event_id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (!tem) {
        return { consumer_key: handler.key, status: "skipped", detail: `${MOTIVO_FORA_DO_PLANO}:${recurso}` };
      }
      return handler.handle(row);
    },
  };
}
