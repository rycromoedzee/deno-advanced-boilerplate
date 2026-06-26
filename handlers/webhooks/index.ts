/**
 * @file handlers/webhooks/index.ts
 * @description Barrel for inbound-webhook handlers (mirrors routes/webhooks/).
 *
 * Route ↔ handler mirror:
 *   webhooks.handler.ts ↔ webhooks.route.ts (provider delivery-status callbacks)
 */

export { emailStatusHandler } from "./webhooks.handler.ts";
