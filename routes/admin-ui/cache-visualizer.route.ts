/**
 * @file routes/admin-ui/cache-visualizer.route.ts
 * @description Cache Visualizer route definition
 */
import { createRoute, HonoContext, z } from "@deps";
import { envConfig } from "@config/env.ts";
import { OpenAPITags } from "@utils/openapi/index.ts";

/**
 * Detailed per-namespace (or aggregated global) cache statistics returned by
 * `GET /__cache-insights/stats`. Mirrors `DetailedCacheStatistics` from
 * `interfaces/cache.ts`. Reused for both the global summary and each entry in
 * the per-namespace map.
 *
 * Note: `lastResetTime` and `createdTime` are `Date` at runtime but are
 * serialized to JSON as ISO-8601 strings.
 */
export const SchemaAdminDetailedCacheStats = z.object({
  hits: z.number().int().nonnegative().openapi({
    description: "Number of cache hits recorded for this scope",
    example: 4127,
  }),
  misses: z.number().int().nonnegative().openapi({
    description: "Number of cache misses recorded for this scope",
    example: 318,
  }),
  hitRate: z.number().min(0).openapi({
    description: "Hit rate as a percentage (0–100), rounded to 2 decimals",
    example: 92.85,
  }),
  entryCount: z.number().int().nonnegative().openapi({
    description: "Number of entries currently in this scope",
    example: 86,
  }),
  totalSize: z.number().min(0).openapi({
    description: "Total byte size of all entries in this scope",
    example: 1048576,
  }),
  averageEntrySize: z.number().min(0).openapi({
    description: "Average entry size in bytes, rounded to 2 decimals",
    example: 12192.84,
  }),
  namespace: z.string().optional().openapi({
    description: "Namespace these stats describe; omitted (undefined) for the aggregated global summary",
    example: "auth:session",
  }),
  lastResetTime: z.date().openapi({
    description: "Most recent stats reset for this scope (date-time; serialized as ISO-8601)",
    example: "2026-06-25T14:30:00.000Z",
  }),
  createdTime: z.date().openapi({
    description: "When the earliest tracked entry was created (date-time; serialized as ISO-8601)",
    example: "2026-06-24T09:12:45.000Z",
  }),
  largestEntrySize: z.number().min(0).openapi({
    description: "Byte size of the largest entry in this scope",
    example: 524288,
  }),
  smallestEntrySize: z.number().min(0).openapi({
    description: "Byte size of the smallest non-zero entry in this scope",
    example: 48,
  }),
}).openapi("AdminDetailedCacheStats");

/**
 * Envelope returned by `GET /__cache-insights/stats`. Source of truth:
 * `cacheVisualizerStatsHandler`.
 */
export const SchemaAdminCacheStats = z.object({
  global: SchemaAdminDetailedCacheStats.openapi({
    description: "Aggregated statistics across all non-redacted namespaces",
  }),
  namespaces: z.record(z.string(), SchemaAdminDetailedCacheStats).openapi({
    description: "Per-namespace detailed statistics, keyed by namespace name (non-redacted namespaces only)",
  }),
  namespacesList: z.array(z.string()).openapi({
    description: "List of non-redacted namespace names included in the breakdown",
    example: ["auth:session", "documents:metadata", "users:profile"],
  }),
}).openapi("AdminCacheStats");

export const visualizerUIRoute = createRoute({
  method: "get",
  path: "/__cache-insights",
  tags: [OpenAPITags.admin],
  summary: "Get cache visualizer UI",
  operationId: "adminCacheVisualizerUiGet",
  description: `Serve the HTML page for the cache visualizer admin tool.

**Behavior:** Reads and returns the static \`services/cache-visualizer/visualizer.html\` file as \`text/html\`. In production, the request must additionally carry an \`Admin-Token\` header (or \`admin_token\` query) matching the internal tool token, otherwise it returns 404 to avoid exposing the tool. (The mount is also behind the internal-tool key middleware.)
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (not tenant-scoped). Returns an HTML document, not JSON.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Cache visualizer HTML page",
      content: { "text/html": { schema: {} } },
    },
    404: {
      description: "Not found — production token missing or invalid",
    },
  },
});

export const visualizerUIHandler = async (c: HonoContext) => {
  if (envConfig.isProduction) {
    const token = c.req.header("Admin-Token") || c.req.query("admin_token");
    if (!token || token !== envConfig.private.internalToolToken) {
      return c.notFound();
    }
  }

  return c.html(
    await Deno.readTextFile("./services/cache-visualizer/visualizer.html"),
  );
};

export const visualizerDataRoute = createRoute({
  method: "get",
  path: "/__cache-insights/data",
  tags: [OpenAPITags.admin],
  summary: "Stream cache entries",
  operationId: "adminCacheEntriesStream",
  description: `Stream all cache entries across namespaces as a JSON array.

**Behavior:** Iterates every cache namespace (skipping those flagged as never-loggable), emitting one entry per item as a streaming JSON array. Each entry includes namespace, key, a redacted value (sensitive keys scrubbed), TTL, expiry, byte size, and creation time. Entries expired for more than 3 hours are skipped.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (not tenant-scoped). Response is streamed; sensitive values are redacted server-side before emission.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      // Schema-less: the handler streams a raw Response (`stream(c, ...)`), and a
      // `content` schema would force a TypedResponse return. Fully typing this
      // endpoint would require buffering the handler (a runtime-behavior change),
      // so the entry shape is documented by the admin-ui consumer type instead.
      description: "JSON array of cache entries (streamed)",
    },
  },
});

export const visualizerStatsRoute = createRoute({
  method: "get",
  path: "/__cache-insights/stats",
  tags: [OpenAPITags.admin],
  summary: "Get cache stats",
  operationId: "adminCacheStatsGet",
  description: `Return aggregate and per-namespace cache statistics.

**Behavior:** Collects detailed statistics (hits, misses, hit rate, entry count, total/average/largest/smallest entry size) for each non-redacted namespace, then returns an aggregated global summary alongside the per-namespace breakdown and the namespace list.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Global and per-namespace cache statistics",
      content: {
        "application/json": {
          schema: SchemaAdminCacheStats,
        },
      },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});
