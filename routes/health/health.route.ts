/**
 * @file routes/health/health.route.ts
 * @description Health route definition
 */
import { createRoute, z } from "@deps";

const HealthResponseSchema = z.object({
  status: z.string().openapi({ example: "ok" }),
  timestamp: z.string().openapi({ example: "2025-01-08T12:00:00.000Z" }),
  uptime: z.number().openapi({ example: 123 }),
  uptimeFormatted: z.string().openapi({ example: "2 hours, 5 minutes" }),
  version: z.string().openapi({ example: "1.0.0" }),
});

const UnavailableResponseSchema = z.object({
  status: z.string().openapi({ example: "unavailable" }),
});

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Health check",
  operationId: "healthCheck",
  description: `Report service readiness.

**Behavior:** Verifies global database connectivity and that bootstrap has completed (at least one environment exists). On success returns a 200 with status, timestamp, uptime (seconds and human-readable), and version. If the database is unreachable or no environment exists, it returns 503 with an \`unavailable\` status.
**Auth:** public
**Permissions:** none
**Notes:** Mounted at the root (\`/health\`) with no authentication; intended for load-balancer and uptime probes. Global (not tenant-scoped).`,
  security: [],
  responses: {
    200: {
      description: "Health check response — system is ready",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
    503: {
      description: "System is not ready to serve traffic",
      content: {
        "application/json": {
          schema: UnavailableResponseSchema,
        },
      },
    },
  },
});
