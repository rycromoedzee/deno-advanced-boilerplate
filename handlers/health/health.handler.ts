/**
 * @file handlers/health/health.handler.ts
 * @description Health request handler
 */
import { z } from "@deps";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { healthRoute } from "@routes/health/health.route.ts";
import { loggerAppSections } from "@logger/index.ts";
import { TIMING_PROFILES } from "@utils/shared/timing.ts";
import { AppHttpException } from "@utils/http-exception.ts";

const SchemaHealthResponse = z.object({
  status: z.string(),
  timestamp: z.string(),
  uptime: z.number(),
  uptimeFormatted: z.string(),
  version: z.string(),
});

// Store the application start time for uptime calculation
const startTime = performance.now();

/**
 * Formats uptime seconds into a human-readable string
 * @param totalSeconds - Total uptime in seconds
 * @returns Formatted string like "2 days, 3 hours" or "5 minutes, 30 seconds"
 */
function formatUptime(totalSeconds: number): string {
  const weeks = Math.floor(totalSeconds / (60 * 60 * 24 * 7));
  const days = Math.floor((totalSeconds % (60 * 60 * 24 * 7)) / (60 * 60 * 24));
  const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts: string[] = [];

  if (weeks > 0) parts.push(`${weeks} week${weeks !== 1 ? "s" : ""}`);
  if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds !== 1 ? "s" : ""}`);

  // Show max 2 parts for readability
  return parts.slice(0, 2).join(", ");
}

export const healthHandler = defineHandler(
  {
    route: healthRoute,
    operationName: "health_check",
    entityType: "health",
    loggerSection: loggerAppSections.INTERNAL,
    timingProfile: TIMING_PROFILES.FAST,
    authContext: false,
    responseSchema: SchemaHealthResponse,
  },
  async () => {
    const currentTime = performance.now();
    const uptimeSeconds = Math.floor((currentTime - startTime) / 1000);

    try {
      // Check global DB connectivity
      const globalDb = getGlobalDB();

      // Check bootstrap completion (at least one environment exists)
      const environments = await globalDb
        .select({ id: globalTables.environments.id })
        .from(globalTables.environments)
        .limit(1);

      if (environments.length === 0) {
        throw new AppHttpException(503, {
          message: "Service unavailable",
          messageKey: "health.unavailable",
        });
      }

      return {
        status: 200 as const,
        data: {
          status: "ok",
          timestamp: new Date().toISOString(),
          uptime: uptimeSeconds,
          uptimeFormatted: formatUptime(uptimeSeconds),
          version: "1.0.0",
        },
      };
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }
      throw new AppHttpException(503, {
        message: "Service unavailable",
        messageKey: "health.unavailable",
      });
    }
  },
);
