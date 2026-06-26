/**
 * @file routes/csp-report/csp-report.route.ts
 * @description CSP violation report route definition
 */

import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

// CSP violation report route
export const cspReportRoute = createRoute({
  method: "post",
  path: "/security/csp/report",
  summary: "Submit CSP violation report",
  operationId: "cspReportCreate",
  description: `Receive Content Security Policy violation reports posted by browsers.

**Behavior:** Parses the standard \`csp-report\` body, converts it to the internal violation format, attaches the request IP and user agent from the request context, and forwards it to the CSP service (\`EnhancedCSPService.processViolationReport\`). Always returns 204, even when parsing or processing fails, so browsers do not retry the report.
**Auth:** public
**Permissions:** none
**Notes:** Browsers post CSP reports automatically and unauthenticated. Mounted on the public app (no auth).`,
  security: [],
  request: {
    body: {
      content: {
        "application/csp-report": {
          schema: z.object({
            "csp-report": z.object({
              "document-uri": z.string().openapi({
                description: "URI of the document where the violation occurred",
                example: "https://app.example.com/dashboard",
              }),
              referrer: z.string().optional().openapi({
                description: "Referrer of the document",
                example: "https://app.example.com/",
              }),
              "violated-directive": z.string().openapi({
                description: "CSP directive that was violated",
                example: "script-src-elem",
              }),
              "effective-directive": z.string().openapi({
                description: "Effective directive name",
                example: "script-src-elem",
              }),
              "original-policy": z.string().openapi({
                description: "Original CSP policy string",
                example: "default-src 'self'; script-src 'self'",
              }),
              disposition: z.string().optional().openapi({
                description: "CSP disposition (enforce or report-only)",
                example: "enforce",
              }),
              "blocked-uri": z.string().openapi({
                description: "URI of the resource that was blocked",
                example: "https://evil.example.com/track.js",
              }),
              "line-number": z.number().optional().openapi({
                description: "Line number of the violation",
                example: 42,
              }),
              "column-number": z.number().optional().openapi({
                description: "Column number of the violation",
                example: 17,
              }),
              "source-file": z.string().optional().openapi({
                description: "URI of the document in which the violation occurred",
                example: "https://app.example.com/assets/app.js",
              }),
              "status-code": z.number().optional().openapi({
                description: "HTTP status code of the blocked resource",
                example: 200,
              }),
              "script-sample": z.string().optional().openapi({
                description: "Sample of the inline script that caused the violation",
                example: "var a = 1;",
              }),
            }),
          }),
        },
      },
    },
  },
  responses: {
    204: {
      description: "CSP report processed successfully",
    },
  },
  tags: [OpenAPITags.security],
});
