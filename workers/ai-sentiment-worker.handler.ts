/**
 * Adapter that exposes `ai-sentiment-worker` to the event_log dispatcher.
 *
 * Registers on `message.received` alongside `ai-response-worker.v1` — both
 * consumers fire in parallel for every inbound message; sentiment never blocks
 * the bot path.
 */

import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { processSentiment } from "@/workers/ai-sentiment-worker";
import { handlerComPlano } from "@/lib/entitlements/handler-com-plano";

export const AI_SENTIMENT_HANDLER_KEY = "ai-sentiment-worker.v1";

const aiSentimentHandlerSemPlano: EventHandler = {
  key: AI_SENTIMENT_HANDLER_KEY,
  events: ["message.received"],
  async handle(row): Promise<HandlerResult> {
    const result = await processSentiment(row);
    if (!result.skipped) {
      return {
        consumer_key: AI_SENTIMENT_HANDLER_KEY,
        status: "ok",
        detail: String(result.sentiment_score ?? ""),
      };
    }
    return {
      consumer_key: AI_SENTIMENT_HANDLER_KEY,
      status: "skipped",
      detail: result.reason,
    };
  },
};

/** Com o gate de plano (migration 0275): sem `ai_agents`, o evento vira `skipped`. */
export const aiSentimentHandler: EventHandler = handlerComPlano(aiSentimentHandlerSemPlano, "ai_agents");
