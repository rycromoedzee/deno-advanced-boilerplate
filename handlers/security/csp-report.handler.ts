/**
 * @file handlers/security/csp-report.handler.ts
 * @description Csp Report request handler
 */
import { type RouteHandler, z } from "@deps";
import { type CSPViolationReport, EnhancedCSPService } from "@services/security/enhanced-csp.service.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { cspReportRoute } from "@routes/csp-report/csp-report.route.ts";

// Zod schema for CSP violation report
const cspViolationReportSchema = z.object({
  "csp-report": z.object({
    "document-uri": z.string(),
    referrer: z.string().optional().default(""),
    "violated-directive": z.string(),
    "effective-directive": z.string(),
    "original-policy": z.string(),
    disposition: z.string().default("enforce"),
    "blocked-uri": z.string(),
    "line-number": z.number().optional(),
    "column-number": z.number().optional(),
    "source-file": z.string().optional(),
    "status-code": z.number().default(200),
    "script-sample": z.string().optional(),
  }),
});

/**
 * Handler for CSP violation reports
 * This endpoint receives reports when CSP policies are violated
 */
export const cspReportHandler: RouteHandler<typeof cspReportRoute> = async (
  c,
) => {
  try {
    // Parse the CSP violation report
    const body = await c.req.json();
    const validatedReport = cspViolationReportSchema.parse(body);
    const cspReport = validatedReport["csp-report"];

    // Convert to our internal format
    const violationReport: CSPViolationReport = {
      documentUri: cspReport["document-uri"],
      referrer: cspReport.referrer,
      violatedDirective: cspReport["violated-directive"],
      effectiveDirective: cspReport["effective-directive"],
      originalPolicy: cspReport["original-policy"],
      disposition: cspReport.disposition,
      blockedUri: cspReport["blocked-uri"],
      lineNumber: cspReport["line-number"],
      columnNumber: cspReport["column-number"],
      sourceFile: cspReport["source-file"],
      statusCode: cspReport["status-code"],
      scriptSample: cspReport["script-sample"],
    };

    // Get request context
    const userContext = IPLookupUtils.getRequestContext(c);
    // Note: CSP reports are sent automatically by browsers without authentication

    // Process the violation report
    await EnhancedCSPService.processViolationReport(violationReport, {
      ip: userContext.ip,
      userAgent: userContext.headers["user-agent"],
    });

    return c.body(null, 204);
  } catch (error) {
    // Log the error but still return success to avoid CSP report retries
    console.error("Failed to process CSP violation report:", error);
    return c.body(null, 204);
  }
};
