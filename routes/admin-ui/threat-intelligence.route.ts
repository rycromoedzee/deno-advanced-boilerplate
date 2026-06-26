/**
 * @file routes/admin-ui/threat-intelligence.route.ts
 * @description Threat Intelligence route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/index.ts";

// =============================================================================
// Shared sub-schemas
//
// The handler's actual return value is the source of truth (see
// handlers/admin-ui/threat-intelligence.handler.ts and the threat-intelligence
// services). The hand-written TS interfaces in
// interfaces/threat-intelligence.ts are a hint but may be drifted; where they
// disagree, the handler wins (noted below per schema).
// =============================================================================

// -- IThreatDatabaseStats (matches IThreatDatabaseStats exactly) -------------
export const SchemaThreatIntelDatabaseStats = z.object({
  totalThreatIPs: z.number().int().openapi({ description: "Count of active threat IP rows", example: 18432 }),
  totalThreatCIDRs: z.number().int().openapi({ description: "Count of active threat CIDR rows", example: 47 }),
  totalWhitelistedIPs: z.number().int().openapi({ description: "Count of active whitelisted IP rows", example: 12 }),
  totalWhitelistedCIDRs: z.number().int().openapi({ description: "Count of active whitelisted CIDR rows", example: 3 }),
  activeSources: z.number().int().openapi({ description: "Count of active threat sources", example: 6 }),
}).openapi("AdminThreatIntelDatabaseStats");

// -- BloomFilterMetrics (from BloomFilterService.getMetrics()) ---------------
export const SchemaThreatIntelBloomMetrics = z.object({
  isInitialized: z.boolean().openapi({ description: "Whether the bloom filter set is initialized", example: true }),
  totalChecks: z.number().openapi({ description: "Total IP checks performed since (re)load", example: 54210 }),
  bloomHits: z.number().openapi({ description: "Bloom filter positive hits", example: 1820 }),
  cidrHits: z.number().openapi({ description: "CIDR range matches", example: 42 }),
  misses: z.number().openapi({ description: "Checks that did not hit", example: 52348 }),
  averageResponseTimeMs: z.number().openapi({ description: "Mean per-check time in ms", example: 0.18 }),
  initializationTimeMs: z.number().openapi({ description: "Time taken to initialize the filters in ms", example: 312.5 }),
  memoryUsageKB: z.number().openapi({ description: "Estimated bloom memory footprint in KB", example: 184.3 }),
  elementsCount: z.number().openapi({ description: "Elements added to the IP filter", example: 18432 }),
  filterCount: z.number().openapi({ description: "Number of scalable filter layers", example: 1 }),
  utilization: z.number().openapi({ description: "Fraction of capacity in use (0-1)", example: 0.42 }),
  falsePositiveRate: z.number().openapi({ description: "Configured false-positive rate", example: 0.001 }),
  capacityRemaining: z.number().openapi({ description: "Remaining IP-filter slots", example: 25411 }),
  needsExpansion: z.boolean().openapi({ description: "Whether utilization crossed the expansion threshold", example: false }),
  capacityWarningThreshold: z.number().openapi({ description: "Utilization threshold that triggers expansion", example: 0.8 }),
}).openapi("AdminThreatIntelBloomMetrics");

// -- ScalableBloomFilter.getStats() / cidrChecker stats (nullable per filter) -
export const SchemaThreatIntelBloomFilterStats = z.object({
  filterCount: z.number().openapi({ description: "Number of stacked filters in this set", example: 1 }),
  elementsAdded: z.number().openapi({ description: "Elements added across all layers", example: 18432 }),
  totalCapacity: z.number().openapi({ description: "Combined capacity across layers", example: 43843 }),
  memoryKB: z.number().openapi({ description: "Memory used by this filter in KB", example: 168.2 }),
  capacity: z.number().openapi({ description: "Capacity (alias of totalCapacity)", example: 43843 }),
  filters: z.array(
    z.object({
      filterCount: z.number().openapi({ description: "Layer index count", example: 1 }),
      elementsAdded: z.number().openapi({ description: "Elements in this layer", example: 18432 }),
      totalCapacity: z.number().openapi({ description: "Layer capacity", example: 43843 }),
      memoryKB: z.number().openapi({ description: "Layer memory in KB", example: 168.2 }),
      capacity: z.number().openapi({ description: "Layer capacity (alias)", example: 43843 }),
    }),
  ).openapi({ description: "Per-layer statistics" }),
}).nullable();

export const SchemaThreatIntelCidrCheckerStats = z.object({
  rangeCount: z.number().openapi({ description: "Number of compiled CIDR ranges", example: 47 }),
  memoryKB: z.number().openapi({ description: "Estimated CIDR checker memory in KB", example: 2 }),
});

// -- bloomStats (from ThreatIntelligenceService.getServiceStats) ------------
// Drift note: this is NOT the IThreatDatabaseStats-style flat object — it wraps
// isInitialized/memoryUsageMB/metrics/filters from BloomFilterService.getStatus().
export const SchemaThreatIntelBloomStats = z.object({
  isInitialized: z.boolean().openapi({ description: "Whether the bloom filter is initialized", example: true }),
  memoryUsageMB: z.number().openapi({ description: "Bloom memory footprint in MB", example: 0.18 }),
  metrics: SchemaThreatIntelBloomMetrics,
  filters: z.object({
    ip: SchemaThreatIntelBloomFilterStats,
    cidr: SchemaThreatIntelBloomFilterStats,
    cidrChecker: SchemaThreatIntelCidrCheckerStats,
  }),
}).openapi("AdminThreatIntelBloomStats");

// -- WhitelistStats (from WhitelistService.getWhitelistStats) ---------------
export const SchemaThreatIntelWhitelistStats = z.object({
  totalIPs: z.number().int().openapi({ description: "In-memory whitelisted IP count", example: 12 }),
  totalCIDRs: z.number().int().openapi({ description: "In-memory whitelisted CIDR count", example: 3 }),
  lastLoadTime: z.number().openapi({ description: "ms taken by the most recent load", example: 4.2 }),
  memoryUsageKB: z.number().openapi({ description: "Estimated whitelist memory in KB", example: 1.6 }),
  cacheHitRate: z.number().openapi({ description: "Lookup cache hit rate (0-1)", example: 0.87 }),
}).openapi("AdminThreatIntelWhitelistStats");

// -- Shared pagination object -----------------------------------------------
export const SchemaThreatIntelPagination = z.object({
  total: z.number().int().openapi({ description: "Total matching items across all pages", example: 184 }),
  page: z.number().int().openapi({ description: "Current page number (1-based)", example: 1 }),
  limit: z.number().int().openapi({ description: "Page size applied (capped at the admin max)", example: 50 }),
  totalPages: z.number().int().openapi({ description: "Total number of pages", example: 4 }),
}).openapi("AdminThreatIntelPagination");

// =============================================================================
// Response schemas (each registered as a named component via .openapi())
// =============================================================================

// -- GET /__threat-intel/status ---------------------------------------------
export const SchemaAdminThreatIntelStatus = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  data: z.object({
    isReady: z.boolean().openapi({ description: "Whether the service is ready to serve checks", example: true }),
    isInitialized: z.boolean().openapi({ description: "Whether initialization has completed", example: true }),
    useBloomFilter: z.boolean().openapi({ description: "Whether bloom-filter optimization is enabled", example: true }),
    bloomStats: SchemaThreatIntelBloomStats,
    dbStats: SchemaThreatIntelDatabaseStats,
    whitelistStats: SchemaThreatIntelWhitelistStats,
  }),
}).openapi("AdminThreatIntelStatus");

// -- Bloom reload before/after stats snapshot --------------------------------
export const SchemaAdminThreatIntelStatsSnapshot = z.object({
  isInitialized: z.boolean().openapi({ description: "Initialization flag at snapshot time", example: true }),
  useBloomFilter: z.boolean().openapi({ description: "Bloom optimization flag at snapshot time", example: true }),
  bloomStats: SchemaThreatIntelBloomStats,
  dbStats: SchemaThreatIntelDatabaseStats,
}).openapi("AdminThreatIntelStatsSnapshot");

// -- BloomFilterService.reload() result -------------------------------------
export const SchemaAdminThreatIntelBloomResult = z.object({
  success: z.boolean().openapi({ description: "Whether the reload succeeded", example: true }),
  initializationTimeMs: z.number().openapi({ description: "Reload wall-clock time in ms", example: 312.5 }),
  ipCount: z.number().int().openapi({ description: "IPs loaded into the rebuilt filter", example: 18432 }),
  cidrCount: z.number().int().openapi({ description: "CIDRs loaded into the rebuilt filter", example: 47 }),
  totalMemoryKB: z.number().openapi({ description: "Rebuilt filter memory footprint in KB", example: 184.3 }),
}).openapi("AdminThreatIntelBloomResult");

// -- POST /__threat-intel/reload --------------------------------------------
export const SchemaAdminThreatIntelReload = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  message: z.string().openapi({ description: "Human-readable result", example: "Bloom filter cache reloaded successfully" }),
  data: z.object({
    reloadTimeMs: z.number().openapi({ description: "Total handler wall-clock time in ms", example: 348.2 }),
    beforeStats: SchemaAdminThreatIntelStatsSnapshot.nullable(),
    afterStats: SchemaAdminThreatIntelStatsSnapshot,
    bloomResult: SchemaAdminThreatIntelBloomResult,
  }),
}).openapi("AdminThreatIntelReload");

// -- IThreatSource.stats -----------------------------------------------------
export const SchemaAdminThreatSourceStats = z.object({
  threatIPsCount: z.number().int().openapi({ description: "Active threat IPs attributed to the source", example: 8421 }),
  threatCIDRsCount: z.number().int().openapi({ description: "Active threat CIDRs attributed to the source", example: 12 }),
}).openapi("AdminThreatSourceStats");

// -- IThreatSource ----------------------------------------------------------
export const SchemaAdminThreatSource = z.object({
  id: z.string().openapi({ description: "Source ID", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  name: z.string().openapi({ description: "Source name", example: "Emerging Threats" }),
  description: z.string().nullable().openapi({ description: "Optional source description", example: "Compromised-host feed" }),
  url: z.string().nullable().openapi({ description: "Optional upstream URL", example: "https://example.com/feed.txt" }),
  isActive: z.boolean().openapi({ description: "Whether the source is active", example: true }),
  updateFrequency: z.number().openapi({ description: "Configured update frequency in hours", example: 24 }),
  totalEntries: z.number().int().openapi({ description: "Stored total entry count for the source", example: 8433 }),
  createdAt: z.string().openapi({ description: "ISO timestamp of source creation", example: "2026-06-01T12:00:00.000Z" }),
  updatedAt: z.string().openapi({ description: "ISO timestamp of last source update", example: "2026-06-25T09:12:00.000Z" }),
  stats: SchemaAdminThreatSourceStats,
}).openapi("AdminThreatSource");

// -- GET /__threat-intel/sources --------------------------------------------
export const SchemaAdminThreatIntelSources = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  data: z.object({
    sources: z.array(SchemaAdminThreatSource),
  }),
}).openapi("AdminThreatIntelSources");

// -- IWhitelistEntry / ICustomBlacklistEntry (shared list-entry shape) -------
// Drift note: handler maps description/url/addedBy/reason to `undefined` when
// absent, so they are optional; metadata is an opaque DB JSON blob.
export const SchemaAdminThreatIntelWhitelistEntry = z.object({
  id: z.string().openapi({ description: "Entry ID", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  type: z.enum(["ip", "cidr"]).openapi({ description: "Entry kind", example: "ip" }),
  value: z.string().openapi({ description: "Whitelisted IP or CIDR value", example: "192.0.2.10" }),
  reason: z.string().nullable().optional().openapi({ description: "Optional reason for whitelisting", example: "Corporate egress" }),
  addedBy: z.string().nullable().optional().openapi({ description: "Who added the entry", example: "Admin" }),
  metadata: z.unknown().nullable().optional().openapi({ description: "Opaque metadata blob from the DB row" }),
  createdAt: z.string().openapi({ description: "ISO timestamp the entry was created", example: "2026-06-20T08:00:00.000Z" }),
  updatedAt: z.string().openapi({ description: "ISO timestamp the entry was last updated", example: "2026-06-20T08:00:00.000Z" }),
}).openapi("AdminThreatIntelWhitelistEntry");

// -- GET /__threat-intel/whitelist/entries ----------------------------------
export const SchemaAdminThreatIntelWhitelistEntries = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  data: z.object({
    entries: z.array(SchemaAdminThreatIntelWhitelistEntry),
    pagination: SchemaThreatIntelPagination,
  }),
}).openapi("AdminThreatIntelWhitelistEntries");

// -- IUpdateLogEntry --------------------------------------------------------
export const SchemaAdminThreatIntelUpdateLogEntry = z.object({
  id: z.string().openapi({ description: "Update log row ID", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  sourceId: z.string().nullable().openapi({
    description: "Source the update targeted (null allowed by the type)",
    example: "clx4src0000pq3x7b9v4r2y",
  }),
  sourceName: z.string().openapi({ description: "Name of the source (falls back to Unknown)", example: "Emerging Threats" }),
  updateType: z.enum(["full", "incremental", "manual"]).openapi({ description: "Kind of update", example: "full" }),
  status: z.enum(["pending", "success", "failed"]).openapi({ description: "Outcome of the update", example: "success" }),
  entriesAdded: z.number().int().openapi({ description: "Rows added during the update", example: 1204 }),
  entriesUpdated: z.number().int().openapi({ description: "Rows updated during the update", example: 18 }),
  entriesRemoved: z.number().int().openapi({ description: "Rows removed during the update", example: 3 }),
  duration: z.number().openapi({ description: "Update duration in ms", example: 4210.5 }),
  errorMessage: z.string().nullable().optional().openapi({ description: "Error message on failure", example: null }),
  metadata: z.unknown().nullable().optional().openapi({ description: "Opaque metadata blob from the DB row" }),
  createdAt: z.string().openapi({ description: "ISO timestamp of the update", example: "2026-06-25T03:00:00.000Z" }),
}).openapi("AdminThreatIntelUpdateLogEntry");

// -- GET /__threat-intel/update-history -------------------------------------
export const SchemaAdminThreatIntelUpdateHistory = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  data: z.object({
    updates: z.array(SchemaAdminThreatIntelUpdateLogEntry),
    pagination: SchemaThreatIntelPagination,
    summary: z.object({
      totalUpdates: z.number().int().openapi({ description: "Total update log rows (unfiltered)", example: 312 }),
      successRate: z.number().openapi({ description: "Success rate as a percentage (0-100)", example: 97.44 }),
      averageDuration: z.number().openapi({ description: "Mean update duration in ms (all rows)", example: 3980.2 }),
    }),
  }),
}).openapi("AdminThreatIntelUpdateHistory");

// -- IPerformanceMetrics ----------------------------------------------------
export const SchemaAdminThreatIntelPerformance = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  data: z.object({
    bloomFilter: z.object({
      totalChecks: z.number().openapi({ description: "Total bloom checks since load", example: 54210 }),
      bloomHits: z.number().openapi({ description: "Bloom positive hits", example: 1820 }),
      cidrHits: z.number().openapi({ description: "CIDR range matches", example: 42 }),
      misses: z.number().openapi({ description: "Non-hits", example: 52348 }),
      hitRate: z.number().openapi({ description: "Combined hit rate as a percentage (0-100)", example: 3.43 }),
      averageResponseTimeMs: z.number().openapi({ description: "Mean per-check time in ms", example: 0.18 }),
      initializationTimeMs: z.number().openapi({ description: "Filter initialization time in ms", example: 312.5 }),
      filterCount: z.number().openapi({ description: "Total filter layers across IP+CIDR", example: 2 }),
      totalElements: z.number().openapi({ description: "Elements in the IP filter", example: 18432 }),
      totalCapacity: z.number().openapi({ description: "Bloom memory footprint in KB (surfaced as capacity)", example: 184.3 }),
      utilization: z.number().openapi({ description: "Capacity utilization (0-1)", example: 0.42 }),
      falsePositiveRate: z.number().openapi({ description: "Estimated false-positive rate", example: 0.001 }),
    }),
    whitelist: z.object({
      totalLookups: z.number().openapi({ description: "Total whitelist lookups", example: 9120 }),
      cacheHits: z.number().openapi({ description: "Estimated whitelist cache hits", example: 7934.4 }),
      hitRate: z.number().openapi({ description: "Cache hit rate as a percentage (0-100)", example: 87 }),
      averageLoadTime: z.number().openapi({ description: "Average load time in ms", example: 4.2 }),
      loadCount: z.number().openapi({ description: "Approximate load count (mirrors totalLookups)", example: 9120 }),
      memoryEfficiency: z.number().openapi({ description: "Entries per KB", example: 9.3 }),
    }),
    cache: z.object({
      hitRate: z.number().openapi({ description: "Placeholder cache hit rate (not yet wired)", example: 0 }),
      missRate: z.number().openapi({ description: "Placeholder cache miss rate (not yet wired)", example: 0 }),
      size: z.number().openapi({ description: "Placeholder cache size (not yet wired)", example: 0 }),
      ttl: z.number().openapi({ description: "Default cache TTL in seconds (placeholder)", example: 300 }),
    }),
  }),
}).openapi("AdminThreatIntelPerformance");

// -- IHealthCheckResponse ---------------------------------------------------
export const SchemaAdminThreatIntelHealthCheckResult = z.object({
  status: z.boolean().openapi({ description: "Whether the check passed", example: true }),
  message: z.string().openapi({ description: "Human-readable check result", example: "Service initialized" }),
});

export const SchemaAdminThreatIntelWhitelistIntegrity = z.object({
  isValid: z.boolean().openapi({ description: "Whether whitelist integrity holds", example: true }),
  issues: z.array(z.string()).openapi({ description: "Detected integrity issues", example: [] }),
  recommendations: z.array(z.string()).openapi({ description: "Recommended remediations", example: [] }),
});

export const SchemaAdminThreatIntelHealth = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  data: z.object({
    overallStatus: z.enum(["healthy", "warning", "critical"]).openapi({
      description: "Roll-up status across all checks",
      example: "healthy",
    }),
    checks: z.object({
      initialization: SchemaAdminThreatIntelHealthCheckResult,
      bloomFilter: z.object({
        status: z.boolean().openapi({ description: "Whether the bloom filter is healthy", example: true }),
        message: z.string().openapi({ description: "Bloom health summary", example: "All bloom checks passed" }),
        metrics: z.unknown().openapi({ description: "Raw per-check metrics from the bloom health probe" }),
      }),
      whitelist: z.object({
        status: z.boolean().openapi({ description: "Whether the whitelist integrity check passed", example: true }),
        message: z.string().openapi({ description: "Whitelist check summary", example: "Whitelist integrity valid" }),
        integrity: SchemaAdminThreatIntelWhitelistIntegrity,
      }),
      database: z.object({
        status: z.boolean().openapi({ description: "Whether the DB connectivity probe succeeded", example: true }),
        message: z.string().openapi({ description: "DB probe summary", example: "Database connected (12ms)" }),
        connectionTime: z.number().openapi({ description: "DB round-trip time in ms", example: 12.3 }),
      }),
      cache: z.object({
        status: z.boolean().openapi({ description: "Whether the cache ping succeeded", example: true }),
        message: z.string().openapi({ description: "Cache liveness summary", example: "Cache service available" }),
      }),
    }),
    summary: z.string().openapi({ description: "Overall human-readable summary", example: "All systems operational" }),
    recommendedActions: z.array(z.string()).openapi({ description: "Suggested remediation actions", example: [] }),
  }),
}).openapi("AdminThreatIntelHealth");

// -- ITrendsAnalytics -------------------------------------------------------
export const SchemaAdminThreatIntelTrends = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  data: z.object({
    period: z.string().openapi({ description: "Aggregation period (hour/day/week/month)", example: "day" }),
    metric: z.string().openapi({ description: "Metric series requested", example: "threats" }),
    data: z.array(
      z.object({
        timestamp: z.string().openapi({ description: "ISO timestamp of the data point", example: "2026-06-25T09:00:00.000Z" }),
        value: z.number().openapi({ description: "Synthetic metric value at this point", example: 18234 }),
      }),
    ).openapi({ description: "Time-series data points (synthetic/mock)" }),
    summary: z.object({
      total: z.number().openapi({ description: "Sum of all data points", example: 437616 }),
      average: z.number().openapi({ description: "Mean of all data points", example: 18234 }),
      min: z.number().openapi({ description: "Minimum data point", example: 14587 }),
      max: z.number().openapi({ description: "Maximum data point", example: 21880 }),
      trend: z.enum(["increasing", "decreasing", "stable"]).openapi({ description: "Derived trend direction", example: "stable" }),
    }),
  }),
}).openapi("AdminThreatIntelTrends");

// -- ICustomBlacklistEntry (custom-blacklist list entry) ---------------------
// Drift note: handler does NOT include `metadata`/`addedBy` on the emitted
// entry; it surfaces `reason`/`riskScore`/`category` instead. `reason` is read
// out of the row's metadata blob and may be undefined.
export const SchemaAdminCustomBlacklistEntry = z.object({
  id: z.string().openapi({ description: "Entry ID", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  type: z.enum(["ip", "cidr"]).openapi({ description: "Entry kind", example: "ip" }),
  value: z.string().openapi({ description: "Blacklisted IP or CIDR value", example: "203.0.113.5" }),
  reason: z.string().nullable().optional().openapi({ description: "Optional reason (from row metadata)", example: "Manual block — abuse" }),
  riskScore: z.number().openapi({ description: "Risk score (100 for custom entries)", example: 100 }),
  category: z.string().openapi({ description: "Threat category", example: "malicious" }),
  createdAt: z.string().openapi({ description: "ISO timestamp the entry was created", example: "2026-06-22T14:30:00.000Z" }),
  updatedAt: z.string().openapi({ description: "ISO timestamp the entry was last updated", example: "2026-06-22T14:30:00.000Z" }),
}).openapi("AdminCustomBlacklistEntry");

// -- GET /__threat-intel/custom-blacklist/entries ---------------------------
export const SchemaAdminThreatIntelCustomBlacklistEntries = z.object({
  success: z.boolean().openapi({ description: "Request outcome", example: true }),
  data: z.object({
    entries: z.array(SchemaAdminCustomBlacklistEntry),
    pagination: SchemaThreatIntelPagination,
  }),
}).openapi("AdminThreatIntelCustomBlacklistEntries");

export const threatIntelReloadRoute = createRoute({
  method: "post",
  path: "/__threat-intel/reload",
  tags: [OpenAPITags.admin],
  summary: "Reload threat-intel bloom filter",
  operationId: "threatIntelBloomReload",
  description: `Clear and rebuild the threat-intelligence bloom filter cache from the database.

**Behavior:** Captures before-stats, reloads the bloom filter service, reinitializes the threat-intelligence service, then returns before/after stats plus reload timing and element/memory counts. All bloom/CIDR/IP filters are rebuilt in place.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (reads the global threat tables; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Bloom filter cache reloaded successfully",
      content: { "application/json": { schema: SchemaAdminThreatIntelReload } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelStatusRoute = createRoute({
  method: "get",
  path: "/__threat-intel/status",
  tags: [OpenAPITags.admin],
  summary: "Get threat-intel status",
  operationId: "threatIntelStatusGet",
  description: `Return the current threat-intelligence service status.

**Behavior:** Reports the service readiness flag plus initialization, bloom-filter, database, and whitelist statistics gathered from the singleton service.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Threat intelligence service status",
      content: { "application/json": { schema: SchemaAdminThreatIntelStatus } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelSourcesRoute = createRoute({
  method: "get",
  path: "/__threat-intel/sources",
  tags: [OpenAPITags.admin],
  summary: "List threat-intel sources",
  operationId: "threatIntelSourcesList",
  description: `List all configured threat-intelligence sources with live entry counts.

**Behavior:** Returns each source (id, name, description, url, active flag, update frequency, total entries, timestamps) enriched with the count of active threat IPs and CIDRs attributed to it, ordered by creation time descending.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (reads the global threat tables; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Threat sources list",
      content: { "application/json": { schema: SchemaAdminThreatIntelSources } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelWhitelistEntriesRoute = createRoute({
  method: "get",
  path: "/__threat-intel/whitelist/entries",
  tags: [OpenAPITags.admin],
  summary: "List threat-intel whitelist",
  operationId: "threatIntelWhitelistList",
  description: `List whitelisted IP and CIDR entries with pagination.

**Behavior:** Accepts \`type\` (\`ip\`, \`cidr\`, or \`all\`), \`page\`, and \`limit\` (capped at the admin pagination max). Returns active entries with id, value, reason, added-by, metadata, and timestamps, plus a pagination object with combined totals.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (reads the global whitelist tables; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Whitelist entries",
      content: { "application/json": { schema: SchemaAdminThreatIntelWhitelistEntries } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelUpdateHistoryRoute = createRoute({
  method: "get",
  path: "/__threat-intel/update-history",
  tags: [OpenAPITags.admin],
  summary: "List threat-intel update history",
  operationId: "threatIntelUpdateHistoryList",
  description: `List threat-intel source update history with pagination and summary.

**Behavior:** Accepts \`sourceId\`, \`status\` (\`pending\`/\`success\`/\`failed\`), \`page\`, and \`limit\` filters. Returns update log rows (entries added/updated/removed, duration, error message, type, status) joined to source name, a pagination object, and an overall summary (total updates, success rate, average duration).
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (reads the global threat tables; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Update history",
      content: { "application/json": { schema: SchemaAdminThreatIntelUpdateHistory } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelPerformanceRoute = createRoute({
  method: "get",
  path: "/__threat-intel/performance",
  tags: [OpenAPITags.admin],
  summary: "Get threat-intel performance",
  operationId: "threatIntelPerformanceGet",
  description: `Return threat-intelligence performance metrics.

**Behavior:** Reports bloom-filter metrics (checks, hits, misses, hit rate, average response time, initialization time, element/capacity counts, utilization, estimated false-positive rate), whitelist lookup metrics (lookups, cache hits, hit rate, load time, memory efficiency), and cache stats. Note: the cache-stats fields are placeholder values and are not yet wired to the real cache layer.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (not tenant-scoped). Cache metrics are currently placeholders.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Performance metrics",
      content: { "application/json": { schema: SchemaAdminThreatIntelPerformance } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelHealthRoute = createRoute({
  method: "get",
  path: "/__threat-intel/health",
  tags: [OpenAPITags.admin],
  summary: "Get threat-intel health",
  operationId: "threatIntelHealthGet",
  description: `Run a threat-intelligence service health check.

**Behavior:** Probes initialization, bloom filter, whitelist integrity, database connectivity (timed query), and cache liveness via an active \`ping()\` to the cache backend. Aggregates an overall status (\`healthy\`/\`warning\`/\`critical\`) with per-check results, a summary message, and recommended remediation actions.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (not tenant-scoped). The cache check actively round-trips the backing store so outages surface here.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Health check",
      content: { "application/json": { schema: SchemaAdminThreatIntelHealth } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelTrendsRoute = createRoute({
  method: "get",
  path: "/__threat-intel/analytics/trends",
  tags: [OpenAPITags.admin],
  summary: "Get threat-intel trends",
  operationId: "threatIntelTrendsGet",
  description: `Return threat-intelligence trend analytics over a time window.

**Behavior:** Accepts \`period\` (\`hour\`/\`day\`/\`week\`/\`month\`) and \`metric\` (\`threats\`/\`checks\`/\`hits\`/other). Generates 24 data points seeded from current database counts with randomized variation, then returns the series plus a summary (total, average, min, max) and a derived trend direction (\`increasing\`/\`decreasing\`/\`stable\`).
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global. The time series is synthetic/mock (no stored time-series data yet), so absolute values are illustrative only.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Trends analytics",
      content: { "application/json": { schema: SchemaAdminThreatIntelTrends } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelAddWhitelistIPRoute = createRoute({
  method: "post",
  path: "/__threat-intel/whitelist/ip",
  tags: [OpenAPITags.admin],
  summary: "Add threat-intel whitelist IP",
  operationId: "threatIntelWhitelistIpAdd",
  description: `Add an IP address to the threat-intel whitelist.

**Behavior:** Reads \`ipAddress\`, optional \`reason\`, and \`metadata\` from the JSON body. Validates the IP, rejects duplicates (active entry already present) with 400, then inserts via the whitelist service attributed to "Admin". Returns 204 on success.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (writes the global whitelist table; not tenant-scoped). Request body is validated by the handler, not by the route schema.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    204: {
      description: "IP added to whitelist successfully",
    },
    400: {
      description: "Bad Request - Invalid IP format or duplicate entry",
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelRemoveWhitelistIPRoute = createRoute({
  method: "delete",
  path: "/__threat-intel/whitelist/ip/:ip",
  tags: [OpenAPITags.admin],
  summary: "Remove threat-intel whitelist IP",
  operationId: "threatIntelWhitelistIpRemove",
  description: `Remove an IP address from the threat-intel whitelist.

**Behavior:** Takes the IP from the path, validates its format (400 on invalid), and removes it via the whitelist service. Returns 204 on success.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (writes the global whitelist table; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    204: {
      description: "IP removed from whitelist successfully",
    },
    400: {
      description: "Bad Request - Invalid IP format",
    },
    404: {
      description: "Not Found - IP not in whitelist",
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelAddWhitelistCIDRRoute = createRoute({
  method: "post",
  path: "/__threat-intel/whitelist/cidr",
  tags: [OpenAPITags.admin],
  summary: "Add threat-intel whitelist CIDR",
  operationId: "threatIntelWhitelistCidrAdd",
  description: `Add a CIDR block to the threat-intel whitelist.

**Behavior:** Reads \`cidrBlock\`, optional \`reason\`, and \`metadata\` from the JSON body. Validates the CIDR, rejects duplicates (active entry already present) with 400, then inserts via the whitelist service attributed to "Admin". Returns 204 on success.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (writes the global whitelist table; not tenant-scoped). Request body is validated by the handler, not by the route schema.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    204: {
      description: "CIDR added to whitelist successfully",
    },
    400: {
      description: "Bad Request - Invalid CIDR format or duplicate entry",
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelRemoveWhitelistCIDRRoute = createRoute({
  method: "delete",
  path: "/__threat-intel/whitelist/cidr/:cidr",
  tags: [OpenAPITags.admin],
  summary: "Remove threat-intel whitelist CIDR",
  operationId: "threatIntelWhitelistCidrRemove",
  description: `Remove a CIDR block from the threat-intel whitelist.

**Behavior:** Takes the CIDR from the path, validates its format (400 on invalid), and removes it via the whitelist service. Returns 204 on success.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (writes the global whitelist table; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    204: {
      description: "CIDR removed from whitelist successfully",
    },
    400: {
      description: "Bad Request - Invalid CIDR format",
    },
    404: {
      description: "Not Found - CIDR not in whitelist",
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelCustomBlacklistEntriesRoute = createRoute({
  method: "get",
  path: "/__threat-intel/custom-blacklist/entries",
  tags: [OpenAPITags.admin],
  summary: "List custom blacklist entries",
  operationId: "threatIntelCustomBlacklistList",
  description: `List custom-blacklist IP and CIDR entries with pagination.

**Behavior:** Accepts \`type\` (\`ip\`/\`cidr\`/\`all\`), \`page\`, and \`limit\`. Reads entries attributed to the seeded "Custom Blacklist" source (returns an empty page if that source is absent) with value, reason, risk score, category, and timestamps, plus combined pagination totals.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (reads the global threat tables; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Custom blacklist entries",
      content: { "application/json": { schema: SchemaAdminThreatIntelCustomBlacklistEntries } },
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelAddCustomBlacklistIPRoute = createRoute({
  method: "post",
  path: "/__threat-intel/custom-blacklist/ip",
  tags: [OpenAPITags.admin],
  summary: "Add custom blacklist IP",
  operationId: "threatIntelBlacklistIpAdd",
  description: `Add an IP address to the custom blacklist.

**Behavior:** Reads \`ipAddress\` and optional \`reason\` from the JSON body, validates the IP (400 on invalid), then upserts it into the global threat-IPs table under the "Custom Blacklist" source at risk score 100 / category "malicious" (re-activating soft-deleted rows). Triggers a bloom-filter reload so the change takes effect immediately. Returns 204 on success.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (writes the global threat tables; not tenant-scoped). Request body is validated by the handler, not by the route schema.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    204: {
      description: "IP added to custom blacklist successfully",
    },
    400: {
      description: "Bad Request - Invalid IP format or duplicate entry",
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelRemoveCustomBlacklistIPRoute = createRoute({
  method: "delete",
  path: "/__threat-intel/custom-blacklist/ip/:ip",
  tags: [OpenAPITags.admin],
  summary: "Remove custom blacklist IP",
  operationId: "threatIntelBlacklistIpRemove",
  description: `Remove an IP address from the custom blacklist.

**Behavior:** Takes the IP from the path, validates its format (400 on invalid), then soft-deletes (sets \`isActive=false\`) the matching threat-IPs row under the "Custom Blacklist" source. Triggers a bloom-filter reload. Returns 204 regardless of whether a matching active row existed.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (writes the global threat tables; not tenant-scoped). Removal is idempotent; a missing entry still returns 204.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    204: {
      description: "IP removed from custom blacklist successfully",
    },
    400: {
      description: "Bad Request - Invalid IP format",
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelAddCustomBlacklistCIDRRoute = createRoute({
  method: "post",
  path: "/__threat-intel/custom-blacklist/cidr",
  tags: [OpenAPITags.admin],
  summary: "Add custom blacklist CIDR",
  operationId: "threatIntelBlacklistCidrAdd",
  description: `Add a CIDR block to the custom blacklist.

**Behavior:** Reads \`cidrBlock\` and optional \`reason\` from the JSON body, validates the CIDR (400 on invalid), then upserts it into the global threat-CIDRs table under the "Custom Blacklist" source at risk score 100 / category "malicious" (re-activating soft-deleted rows). Triggers a bloom-filter reload. Returns 204 on success.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (writes the global threat tables; not tenant-scoped). Request body is validated by the handler, not by the route schema.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    204: {
      description: "CIDR added to custom blacklist successfully",
    },
    400: {
      description: "Bad Request - Invalid CIDR format or duplicate entry",
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});

export const threatIntelRemoveCustomBlacklistCIDRRoute = createRoute({
  method: "delete",
  path: "/__threat-intel/custom-blacklist/cidr/:cidr",
  tags: [OpenAPITags.admin],
  summary: "Remove custom blacklist CIDR",
  operationId: "threatIntelBlacklistCidrRemove",
  description: `Remove a CIDR block from the custom blacklist.

**Behavior:** Takes the CIDR from the path, validates its format (400 on invalid), then soft-deletes (sets \`isActive=false\`) the matching threat-CIDRs row under the "Custom Blacklist" source. Triggers a bloom-filter reload. Returns 204 regardless of whether a matching active row existed.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (writes the global threat tables; not tenant-scoped). Removal is idempotent; a missing entry still returns 204.`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    204: {
      description: "CIDR removed from custom blacklist successfully",
    },
    400: {
      description: "Bad Request - Invalid CIDR format",
    },
    405: {
      description: "Method Not Allowed",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});
