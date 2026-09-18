/**
 * Adapter that exposes `ai-response-worker` to the event_log dispatcher.
 *
 * Kept separate from the worker pipeline file so unit tests can import the
 * pipeline (`processMessageReceived`) without pulling in the dispatcher
 * registry, and so the handler key (the source-of-truth string written into
 * `event_log.consumed_by[]`) lives in one obvious place.
 */

import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { processMessageReceived } from "@/workers/ai-response-worker";
import { handlerComPlano } from "@/lib/entitlements/handler-com-plano";

export const AI_RESPONSE_HANDLER_KEY = "ai-response-worker.v1";

const aiResponseHandlerSemPlano: EventHandler = {
  key: AI_RESPONSE_HANDLER_KEY,
  events: ["message.received"],
  async handle(row): Promise<HandlerResult> {
    const result = await processMessageReceived(row);
    if (result.status === "sent_to_dispatch") {
      return { consumer_key: AI_RESPONSE_HANDLER_KEY, status: "ok", detail: result.outbound_message_id };
    }
    if (result.status === "skipped") {
      return {
        consumer_key: AI_RESPONSE_HANDLER_KEY,
        status: "skipped",
        detail: result.reason,
      };
    }
    return { consumer_key: AI_RESPONSE_HANDLER_KEY, status: "error", detail: result.detail };
  },
};

/** Com o gate de plano (migration 0275): sem `ai_agents`, o evento vira `skipped`. */
export const aiResponseHandler: EventHandler = handlerComPlano(aiResponseHandlerSemPlano, "ai_agents");
