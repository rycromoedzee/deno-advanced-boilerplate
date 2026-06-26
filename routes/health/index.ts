/**
 * @file routes/health/index.ts
 * @description Health-check feature — wiring module
 *
 * Liveness/readiness probe (no auth). The route is registered on a small
 * sub-app so it can be mounted on both the full app and the public-only docs
 * app in main.ts.
 */

import { OpenAPIHono } from "@deps";
import { healthRoute } from "./health.route.ts";
import { healthHandler } from "@handlers/health/index.ts";

const healthApp = new OpenAPIHono();

healthApp.openapi(healthRoute, healthHandler);

export default healthApp;
