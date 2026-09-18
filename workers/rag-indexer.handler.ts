/**
 * Adapter that exposes `rag-indexer` to the event_log dispatcher.
 *
 * Kept separate from the worker pipeline file so unit tests can import
 * `processRagIndexer` directly without pulling in the dispatcher registry.
 */

import type { EventHandler } from "@/lib/event-log/dispatcher";
import { processRagIndexer } from "@/workers/rag-indexer";
import { handlerComPlano } from "@/lib/entitlements/handler-com-plano";

export const RAG_INDEXER_HANDLER_KEY = "rag-indexer.v1";

const ragIndexerHandlerSemPlano: EventHandler = {
  key: RAG_INDEXER_HANDLER_KEY,
  events: ["nuvemshop.product_synced", "knowledge_source.updated"],
  handle: processRagIndexer,
};

/** Com o gate de plano (migration 0275): sem `ai_agents`, o evento vira `skipped`. */
export const ragIndexerHandler: EventHandler = handlerComPlano(ragIndexerHandlerSemPlano, "ai_agents");
