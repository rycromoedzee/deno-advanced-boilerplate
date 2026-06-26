/**
 * @file handlers/security/index.ts
 * @description Barrel for security-event handlers (mirrors routes/csp-report/).
 *
 * Route ↔ handler mirror:
 *   csp-report.handler.ts ↔ routes/csp-report/csp-report.route.ts (Content-Security-Policy violation ingest)
 */

export { cspReportHandler } from "./csp-report.handler.ts";
