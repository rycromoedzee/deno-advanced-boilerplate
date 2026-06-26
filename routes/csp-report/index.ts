/**
 * @file routes/csp-report/index.ts
 * @description CSP violation report feature — wiring module
 *
 * Builds the CSP-report sub-app that receives Content-Security-Policy
 * violation reports from browsers (public, unauthenticated endpoint).
 */

import { OpenAPIHono } from "@deps";
import { cspReportRoute } from "./csp-report.route.ts";
import { cspReportHandler } from "@handlers/security/index.ts";

const cspReportApp = new OpenAPIHono();

cspReportApp.openapi(cspReportRoute, cspReportHandler);

export default cspReportApp;
