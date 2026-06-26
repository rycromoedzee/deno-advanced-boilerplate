/**
 * @file handlers/health/index.ts
 * @description Barrel for health-check handlers.
 *
 * Route ↔ handler mirror:
 *   health.handler.ts ↔ routes/health/health.route.ts (liveness/readiness probe, no auth)
 */

export { healthHandler } from "./health.handler.ts";
