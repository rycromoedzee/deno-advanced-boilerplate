/**
 * @file services/shared/index.ts
 * @description Exports for shared SSE infrastructure and Pub/Sub services
 */

// SSE infrastructure
export { BaseSSEService } from "./base-sse.service.ts";
export type { SSEConnection, SSEEvent, SSEResponseOptions } from "./sse.types.ts";

// Pub/Sub infrastructure
export { EventEmitterPubSubService } from "./event-emitter-pubsub.service.ts";
export { type RedisPubSubConfig, RedisPubSubService } from "./redis-pubsub.service.ts";
export { getPubSubService, isDistributedPubSub, resetPubSubService } from "./pubsub.factory.ts";
export type { IPubSubService, PubSubConfig } from "@interfaces/pubsub.ts";
