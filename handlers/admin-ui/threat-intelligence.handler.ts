/**
 * @file handlers/admin-ui/threat-intelligence.handler.ts
 * @description Threat Intelligence request handler
 */
import type { HonoContext } from "@deps";
import { and, count, desc, eq, HTTPException, inArray, sql } from "@deps";
import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { calculatePagination } from "@utils/shared/index.ts";
import { ADMIN_PAGINATION_MAX } from "@constants/pagination.ts";
import { getThreatIntelligenceService, getWhitelistService } from "@services/threat-intelligence/index.ts";
import { getCache } from "@services/cache/index.ts";

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { IPValidationUtils } from "@utils/network/ip-validation.ts";
import {
  type IAddWhitelistCIDRRequest,
  type IAddWhitelistIPRequest,
  type IHealthCheckResponse,
  type IPerformanceMetrics,
  type IThreatSource,
  type ITrendsAnalytics,
  type IUpdateHistoryResponse,
  type IWhitelistEntriesResponse,
} from "@interfaces/threat-intelligence.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";

// Get singleton instances via getter functions
const threatIntelligenceService = getThreatIntelligenceService();
const whitelistService = getWhitelistService();

/**
 * Handler to clear and reload bloom filter cache from database
 */
export const threatIntelReloadHandler = async (c: HonoContext) => {
  // Validate HTTP method
  if (c.req.method !== "POST") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    useLogger(LoggerLevels.info, {
      message: "🔄 Starting bloom filter cache reload...",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "BLOOM_RELOAD_START",
    });

    const startTime = performance.now();

    // Step 1: Get current stats before reload
    const beforeStats = threatIntelligenceService.isReady() ? await threatIntelligenceService.getServiceStats() : null;

    // Step 2: Clear and reload bloom filters (use the one from threatIntelligenceService)
    const bloomResult = await threatIntelligenceService.bloomFilterService.reload();

    // Step 3: Reinitialize main service after successful reload
    await threatIntelligenceService.initialize();

    // Step 4: Get stats after reload
    const afterStats = await threatIntelligenceService.getServiceStats();

    const reloadTime = performance.now() - startTime;

    useLogger(LoggerLevels.info, {
      message: `✅ Bloom filter cache reloaded successfully in ${reloadTime.toFixed(2)}ms`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "BLOOM_RELOAD_COMPLETE",
      details: {
        reloadTimeMs: reloadTime,
        beforeStats,
        afterStats,
        bloomResult,
      },
    });

    return c.json({
      success: true,
      message: "Bloom filter cache reloaded successfully",
      data: {
        reloadTimeMs: Math.round(reloadTime * 100) / 100,
        beforeStats: beforeStats
          ? {
            isInitialized: beforeStats.isInitialized,
            useBloomFilter: beforeStats.useBloomFilter,
            bloomStats: beforeStats.bloomStats,
            dbStats: beforeStats.dbStats,
          }
          : null,
        afterStats: {
          isInitialized: afterStats.isInitialized,
          useBloomFilter: afterStats.useBloomFilter,
          bloomStats: afterStats.bloomStats,
          dbStats: afterStats.dbStats,
        },
        bloomResult: {
          success: bloomResult.success,
          initializationTimeMs: bloomResult.initializationTimeMs,
          ipCount: bloomResult.ipCount,
          cidrCount: bloomResult.cidrCount,
          totalMemoryKB: bloomResult.totalMemoryKB,
        },
      },
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "❌ Failed to reload bloom filter cache",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "BLOOM_RELOAD_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to reload bloom filter cache",
      cause: error,
    });
  }
};

/**
 * Handler to get all threat sources
 */
export const threatIntelSourcesHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();

    // Get all sources with their entry counts
    const sources = await db
      .select({
        id: globalTables.threatSources.id,
        name: globalTables.threatSources.name,
        description: globalTables.threatSources.description,
        url: globalTables.threatSources.url,
        isActive: globalTables.threatSources.isActive,
        updateFrequency: globalTables.threatSources.updateFrequency,
        totalEntries: globalTables.threatSources.totalEntries,
        createdAt: globalTables.threatSources.createdAt,
        updatedAt: globalTables.threatSources.updatedAt,
      })
      .from(globalTables.threatSources)
      .orderBy(desc(globalTables.threatSources.createdAt));

    // Get counts for each source
    const sourceIds = sources.map((s) => s.id);

    const [ipCounts, cidrCounts] = await Promise.all([
      db
        .select({
          sourceId: globalTables.threatIPs.sourceId,
          count: count(),
        })
        .from(globalTables.threatIPs)
        .where(and(
          eq(globalTables.threatIPs.isActive, true),
          sourceIds.length > 0 ? inArray(globalTables.threatIPs.sourceId, sourceIds) : sql`false`,
        ))
        .groupBy(globalTables.threatIPs.sourceId),
      db
        .select({
          sourceId: globalTables.threatCIDRs.sourceId,
          count: count(),
        })
        .from(globalTables.threatCIDRs)
        .where(and(
          eq(globalTables.threatCIDRs.isActive, true),
          sourceIds.length > 0 ? inArray(globalTables.threatCIDRs.sourceId, sourceIds) : sql`false`,
        ))
        .groupBy(globalTables.threatCIDRs.sourceId),
    ]);

    const ipCountMap = new Map(ipCounts.map((c) => [c.sourceId, c.count]));
    const cidrCountMap = new Map(cidrCounts.map((c) => [c.sourceId, c.count]));

    const sourcesWithStats: IThreatSource[] = sources.map((source) => ({
      id: source.id,
      name: source.name,
      description: source.description || undefined,
      url: source.url || undefined,
      isActive: source.isActive,
      updateFrequency: source.updateFrequency || 24,
      totalEntries: source.totalEntries || 0,
      createdAt: new Date(source.createdAt * 1000).toISOString(),
      updatedAt: new Date(source.updatedAt * 1000).toISOString(),
      stats: {
        threatIPsCount: ipCountMap.get(source.id) || 0,
        threatCIDRsCount: cidrCountMap.get(source.id) || 0,
      },
    }));

    return c.json({
      success: true,
      data: {
        sources: sourcesWithStats,
      },
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Failed to get threat sources",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "SOURCES_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to get threat sources",
      cause: error,
    });
  }
};

/**
 * Handler to get whitelist entries
 */
export const threatIntelWhitelistEntriesHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();
    const type = c.req.query("type") || "all";
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), ADMIN_PAGINATION_MAX); // Admin UI: internal ceiling (500)
    const { offset } = calculatePagination(page, limit, 0);

    const entries = [];

    if (type === "ip" || type === "all") {
      const ipEntries = await db
        .select({
          id: globalTables.whitelistedIPs.id,
          ipAddress: globalTables.whitelistedIPs.ipAddress,
          reason: globalTables.whitelistedIPs.reason,
          addedBy: globalTables.whitelistedIPs.addedBy,
          metadata: globalTables.whitelistedIPs.metadata,
          createdAt: globalTables.whitelistedIPs.createdAt,
          updatedAt: globalTables.whitelistedIPs.updatedAt,
        })
        .from(globalTables.whitelistedIPs)
        .where(eq(globalTables.whitelistedIPs.isActive, true))
        .limit(limit)
        .offset(offset);

      entries.push(...ipEntries.map((e) => ({
        id: e.id,
        type: "ip" as const,
        value: e.ipAddress,
        reason: e.reason || undefined,
        addedBy: e.addedBy || undefined,
        metadata: e.metadata || undefined,
        createdAt: new Date(e.createdAt * 1000).toISOString(),
        updatedAt: new Date(e.updatedAt * 1000).toISOString(),
      })));
    }

    if (type === "cidr" || type === "all") {
      const cidrEntries = await db
        .select({
          id: globalTables.whitelistedCIDRs.id,
          cidrBlock: globalTables.whitelistedCIDRs.cidrBlock,
          reason: globalTables.whitelistedCIDRs.reason,
          addedBy: globalTables.whitelistedCIDRs.addedBy,
          metadata: globalTables.whitelistedCIDRs.metadata,
          createdAt: globalTables.whitelistedCIDRs.createdAt,
          updatedAt: globalTables.whitelistedCIDRs.updatedAt,
        })
        .from(globalTables.whitelistedCIDRs)
        .where(eq(globalTables.whitelistedCIDRs.isActive, true))
        .limit(limit)
        .offset(offset);

      entries.push(...cidrEntries.map((e) => ({
        id: e.id,
        type: "cidr" as const,
        value: e.cidrBlock,
        reason: e.reason || undefined,
        addedBy: e.addedBy || undefined,
        metadata: e.metadata || undefined,
        createdAt: new Date(e.createdAt * 1000).toISOString(),
        updatedAt: new Date(e.updatedAt * 1000).toISOString(),
      })));
    }

    const [ipTotal, cidrTotal] = await Promise.all([
      db.select({ count: count() }).from(globalTables.whitelistedIPs).where(eq(globalTables.whitelistedIPs.isActive, true)),
      db.select({ count: count() }).from(globalTables.whitelistedCIDRs).where(eq(globalTables.whitelistedCIDRs.isActive, true)),
    ]);

    const total = (ipTotal[0]?.count || 0) + (cidrTotal[0]?.count || 0);
    const { pagination } = calculatePagination(page, limit, total);

    const response: IWhitelistEntriesResponse = {
      entries,
      pagination: {
        total: pagination.total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: pagination.totalPages,
      },
    };

    return c.json({
      success: true,
      data: response,
    });
  } catch (error) {
    // Check for PostgreSQL-specific error details
    if (error && typeof error === "object" && "cause" in error) {
      console.error(`[DIAGNOSTIC] PostgreSQL cause:`, error.cause);
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to get whitelist entries",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_ENTRIES_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to get whitelist entries",
      cause: error,
    });
  }
};

/**
 * Handler to get update history
 */
export const threatIntelUpdateHistoryHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();
    const sourceId = c.req.query("sourceId");
    const status = c.req.query("status");
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), ADMIN_PAGINATION_MAX);
    const { offset } = calculatePagination(page, limit, 0);

    // Build where conditions
    const conditions = [];
    if (sourceId) {
      conditions.push(eq(globalTables.threatUpdateLog.sourceId, sourceId));
    }
    if (status && ["pending", "success", "failed"].includes(status)) {
      conditions.push(eq(globalTables.threatUpdateLog.status, status));
    }

    const updates = await db
      .select({
        id: globalTables.threatUpdateLog.id,
        sourceId: globalTables.threatUpdateLog.sourceId,
        sourceName: globalTables.threatSources.name,
        updateType: globalTables.threatUpdateLog.updateType,
        status: globalTables.threatUpdateLog.status,
        entriesAdded: globalTables.threatUpdateLog.entriesAdded,
        entriesUpdated: globalTables.threatUpdateLog.entriesUpdated,
        entriesRemoved: globalTables.threatUpdateLog.entriesRemoved,
        duration: globalTables.threatUpdateLog.duration,
        errorMessage: globalTables.threatUpdateLog.errorMessage,
        metadata: globalTables.threatUpdateLog.metadata,
        createdAt: globalTables.threatUpdateLog.createdAt,
      })
      .from(globalTables.threatUpdateLog)
      .innerJoin(globalTables.threatSources, eq(globalTables.threatUpdateLog.sourceId, globalTables.threatSources.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(globalTables.threatUpdateLog.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const totalCount = await db
      .select({ count: count() })
      .from(globalTables.threatUpdateLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = totalCount[0]?.count || 0;
    const { pagination } = calculatePagination(page, limit, total);

    // Calculate summary
    const allUpdates = await db
      .select({
        status: globalTables.threatUpdateLog.status,
        duration: globalTables.threatUpdateLog.duration,
      })
      .from(globalTables.threatUpdateLog);

    const totalUpdates = allUpdates.length;
    const successUpdates = allUpdates.filter((u) => u.status === "success").length;
    const successRate = totalUpdates > 0 ? (successUpdates / totalUpdates) * 100 : 0;
    const averageDuration = allUpdates.length > 0 ? allUpdates.reduce((sum, u) => sum + (u.duration || 0), 0) / allUpdates.length : 0;

    const response: IUpdateHistoryResponse = {
      updates: updates.map((u) => ({
        id: u.id,
        sourceId: u.sourceId,
        sourceName: u.sourceName || "Unknown",
        updateType: u.updateType as "full" | "incremental" | "manual",
        status: u.status as "pending" | "success" | "failed",
        entriesAdded: u.entriesAdded || 0,
        entriesUpdated: u.entriesUpdated || 0,
        entriesRemoved: u.entriesRemoved || 0,
        duration: u.duration || 0,
        errorMessage: u.errorMessage || undefined,
        metadata: u.metadata || undefined,
        createdAt: new Date(u.createdAt * 1000).toISOString(),
      })),
      pagination: {
        total: pagination.total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: pagination.totalPages,
      },
      summary: {
        totalUpdates,
        successRate: Math.round(successRate * 100) / 100,
        averageDuration: Math.round(averageDuration * 100) / 100,
      },
    };

    return c.json({
      success: true,
      data: response,
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Failed to get update history",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "UPDATE_HISTORY_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to get update history",
      cause: error,
    });
  }
};

/**
 * Handler to get performance metrics
 */
export const threatIntelPerformanceHandler = (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    // Get bloom filter metrics using getStatus() (consolidated method)
    const bloomStatus = threatIntelligenceService.bloomFilterService.getStatus();
    const bloomMetrics = bloomStatus.metrics;

    const totalChecks = bloomMetrics.totalChecks || 0;
    const bloomHits = bloomMetrics.bloomHits || 0;
    const cidrHits = bloomMetrics.cidrHits || 0;
    const misses = bloomMetrics.misses || 0;
    const hitRate = totalChecks > 0 ? ((bloomHits + cidrHits) / totalChecks) * 100 : 0;

    // Get whitelist metrics
    const whitelistPerf = whitelistService.getPerformanceMetrics();

    // NOTE: real-time cache performance metrics not yet wired — values are placeholders.
    // getCache().getStats() is available but is not surfaced here (see cache.service.ts getStats).
    const cacheStats = {
      hitRate: 0,
      missRate: 0,
      size: 0,
      ttl: 300, // Default 5 minutes
    };

    const response: IPerformanceMetrics = {
      bloomFilter: {
        totalChecks,
        bloomHits,
        cidrHits,
        misses,
        hitRate: Math.round(hitRate * 100) / 100,
        averageResponseTimeMs: Math.round((bloomMetrics.averageResponseTimeMs || 0) * 100) / 100,
        initializationTimeMs: Math.round((bloomMetrics.initializationTimeMs || 0) * 100) / 100,
        filterCount: (bloomStatus.filters.ip?.filterCount || 0) + (bloomStatus.filters.cidr?.filterCount || 0),
        totalElements: bloomMetrics.elementsCount || 0,
        totalCapacity: bloomStatus.memoryUsageKB || 0,
        utilization: bloomMetrics.utilization || 0,
        falsePositiveRate: bloomStatus.filters.ip?.filters?.[0]?.estimatedFalsePositiveRate || 0,
      },
      whitelist: {
        totalLookups: whitelistPerf.totalLookups,
        cacheHits: whitelistPerf.cacheHitRate * whitelistPerf.totalLookups,
        hitRate: Math.round(whitelistPerf.cacheHitRate * 100) / 100,
        averageLoadTime: Math.round(whitelistPerf.averageLoadTime * 100) / 100,
        loadCount: whitelistPerf.totalLookups, // Approximate
        memoryEfficiency: Math.round(whitelistPerf.memoryEfficiency * 100) / 100,
      },
      cache: cacheStats,
    };

    return c.json({
      success: true,
      data: response,
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Failed to get performance metrics",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "PERFORMANCE_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to get performance metrics",
      cause: error,
    });
  }
};

/**
 * Handler to get health check
 */
export const threatIntelHealthHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();
    const recommendedActions: string[] = [];
    let overallStatus: "healthy" | "warning" | "critical" = "healthy";

    // Check initialization
    const isInitialized = threatIntelligenceService.isReady();
    const initCheck = {
      status: isInitialized,
      message: isInitialized ? "Service initialized" : "Service not initialized",
    };

    if (!isInitialized) {
      overallStatus = "critical";
      recommendedActions.push("Initialize threat intelligence service");
    }

    // Check bloom filter (use the one from threatIntelligenceService which is properly initialized)
    const bloomHealth = threatIntelligenceService.bloomFilterService.performHealthCheck();
    const bloomCheck = {
      status: bloomHealth.status === "healthy",
      message: bloomHealth.summary,
      metrics: bloomHealth.checks,
    };

    if (bloomHealth.status === "warning") {
      overallStatus = overallStatus === "critical" ? "critical" : "warning";
      recommendedActions.push(...bloomHealth.recommendedActions);
    }

    // Check whitelist
    const whitelistIntegrity = whitelistService.validateIntegrity();
    const whitelistCheck = {
      status: whitelistIntegrity.isValid,
      message: whitelistIntegrity.isValid ? "Whitelist integrity valid" : "Whitelist issues detected",
      integrity: whitelistIntegrity,
    };

    if (!whitelistIntegrity.isValid) {
      overallStatus = overallStatus === "critical" ? "critical" : "warning";
      recommendedActions.push(...whitelistIntegrity.recommendations);
    }

    // Check database
    const dbStartTime = performance.now();
    let dbCheck = {
      status: false,
      message: "Database connection failed",
      connectionTime: 0,
    };

    try {
      await db.select({ count: count() }).from(globalTables.threatSources).limit(1);
      const dbConnectionTime = performance.now() - dbStartTime;
      dbCheck = {
        status: true,
        message: `Database connected (${Math.round(dbConnectionTime)}ms)`,
        connectionTime: Math.round(dbConnectionTime * 100) / 100,
      };
    } catch {
      overallStatus = "critical";
      recommendedActions.push("Check database connection");
    }

    // Check cache liveness. ping() actively round-trips the backing store
    // (Redis PING / KV read), so a disconnected backend flips status to false —
    // unlike get(), whose providers fail open and would mask the outage.
    let cacheStatus = true;
    let cacheMessage = "Cache service available";
    try {
      const cacheAlive = await (await getCache()).ping();
      if (!cacheAlive) {
        cacheStatus = false;
        cacheMessage = "Cache backend unreachable";
        overallStatus = overallStatus === "critical" ? "critical" : "warning";
        recommendedActions.push("Check cache service / Redis connectivity");
      }
    } catch {
      cacheStatus = false;
      cacheMessage = "Cache service check failed";
      overallStatus = overallStatus === "critical" ? "critical" : "warning";
      recommendedActions.push("Check cache service");
    }
    const cacheCheck = {
      status: cacheStatus,
      message: cacheMessage,
    };

    const response: IHealthCheckResponse = {
      overallStatus,
      checks: {
        initialization: initCheck,
        bloomFilter: bloomCheck,
        whitelist: whitelistCheck,
        database: dbCheck,
        cache: cacheCheck,
      },
      summary: overallStatus === "healthy"
        ? "All systems operational"
        : overallStatus === "warning"
        ? "Some systems require attention"
        : "Critical issues detected",
      recommendedActions,
    };

    return c.json({
      success: true,
      data: response,
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Failed to perform health check",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "HEALTH_CHECK_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to perform health check",
      cause: error,
    });
  }
};

/**
 * Handler to get trends analytics
 */
export const threatIntelTrendsHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const period = c.req.query("period") || "day";
    const metric = c.req.query("metric") || "threats";

    // This is a simplified implementation
    // In production, you would store time-series data and query it
    // For now, we'll return mock data based on current database state

    const db = getGlobalDB();

    // Get current counts
    const [threatCount, sourceCount] = await Promise.all([
      db.select({ count: count() }).from(globalTables.threatIPs).where(eq(globalTables.threatIPs.isActive, true)),
      db.select({ count: count() }).from(globalTables.threatSources).where(eq(globalTables.threatSources.isActive, true)),
    ]);

    const totalThreats = threatCount[0]?.count || 0;
    const _totalSources = sourceCount[0]?.count || 0;

    // Generate mock time series data
    const dataPoints = 24; // 24 data points
    const data: Array<{ timestamp: string; value: number }> = [];
    const now = Date.now();
    const periodMs = period === "hour" ? 3600000 : period === "day" ? 86400000 : period === "week" ? 604800000 : 2592000000;

    for (let i = dataPoints - 1; i >= 0; i--) {
      const timestamp = new Date(now - (i * periodMs)).toISOString();
      // Generate some variation around the current value
      const variation = 0.8 + Math.random() * 0.4; // 80% to 120%
      const value = metric === "threats"
        ? Math.round(totalThreats * variation)
        : metric === "checks"
        ? Math.round(1000 * variation)
        : metric === "hits"
        ? Math.round(50 * variation)
        : Math.round(5 * variation);

      data.push({ timestamp, value });
    }

    const values = data.map((d) => d.value);
    const total = values.reduce((sum, v) => sum + v, 0);
    const average = total / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Determine trend
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;
    const trend = secondAvg > firstAvg * 1.05 ? "increasing" : secondAvg < firstAvg * 0.95 ? "decreasing" : "stable";

    const response: ITrendsAnalytics = {
      period,
      metric,
      data,
      summary: {
        total,
        average: Math.round(average * 100) / 100,
        min,
        max,
        trend,
      },
    };

    return c.json({
      success: true,
      data: response,
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Failed to get trends analytics",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "TRENDS_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to get trends analytics",
      cause: error,
    });
  }
};

/**
 * Handler to get threat intelligence service status
 */
export const threatIntelStatusHandler = async (c: HonoContext) => {
  // Validate HTTP method
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const stats = await threatIntelligenceService.getServiceStats();

    return c.json({
      success: true,
      data: {
        isReady: threatIntelligenceService.isReady(),
        isInitialized: stats.isInitialized,
        useBloomFilter: stats.useBloomFilter,
        bloomStats: stats.bloomStats,
        dbStats: stats.dbStats,
        whitelistStats: stats.whitelistStats,
      },
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Failed to get threat intelligence status",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "STATUS_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to get threat intelligence status",
      cause: error,
    });
  }
};

/**
 * Handler to add IP to whitelist
 */
export const threatIntelAddWhitelistIPHandler = async (c: HonoContext) => {
  if (c.req.method !== "POST") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const body = await c.req.json<IAddWhitelistIPRequest>();
    const { ipAddress, reason, metadata } = body;

    // Validate IP address
    if (!ipAddress || !IPValidationUtils.isValidIP(ipAddress)) {
      throw new HTTPException(400, {
        message: "Invalid IP address format",
      });
    }

    // Check for duplicate
    const db = getGlobalDB();
    const existing = await db
      .select({ id: globalTables.whitelistedIPs.id })
      .from(globalTables.whitelistedIPs)
      .where(and(
        eq(globalTables.whitelistedIPs.ipAddress, ipAddress),
        eq(globalTables.whitelistedIPs.isActive, true),
      ));

    if (existing.length > 0) {
      throw new HTTPException(400, {
        message: "IP address already exists in whitelist",
      });
    }

    // Add to whitelist
    await whitelistService.addIPToWhitelist(
      ipAddress,
      reason || "",
      "Admin",
    );

    useLogger(LoggerLevels.info, {
      message: `IP ${ipAddress} added to whitelist by Admin`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_IP_ADD",
      details: { ipAddress, reason, metadata },
    });

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to add IP to whitelist",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_IP_ADD_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to add IP to whitelist",
      cause: error,
    });
  }
};

/**
 * Handler to remove IP from whitelist
 */
export const threatIntelRemoveWhitelistIPHandler = async (c: HonoContext) => {
  if (c.req.method !== "DELETE") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const ip = c.req.param("ip");

    // Validate IP address
    if (!ip || !IPValidationUtils.isValidIP(ip)) {
      throw new HTTPException(400, {
        message: "Invalid IP address format",
      });
    }

    // Remove from whitelist
    await whitelistService.removeIPFromWhitelist(ip);

    useLogger(LoggerLevels.info, {
      message: `IP ${ip} removed from whitelist by Admin`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_IP_REMOVE",
      details: { ip },
    });

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to remove IP from whitelist",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_IP_REMOVE_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to remove IP from whitelist",
      cause: error,
    });
  }
};

/**
 * Handler to add CIDR to whitelist
 */
export const threatIntelAddWhitelistCIDRHandler = async (c: HonoContext) => {
  if (c.req.method !== "POST") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const body = await c.req.json<IAddWhitelistCIDRRequest>();
    const { cidrBlock, reason, metadata } = body;

    // Validate CIDR block
    if (!cidrBlock || !IPValidationUtils.isValidCIDR(cidrBlock)) {
      throw new HTTPException(400, {
        message: "Invalid CIDR block format",
      });
    }

    // Check for duplicate
    const db = getGlobalDB();
    const existing = await db
      .select({ id: globalTables.whitelistedCIDRs.id })
      .from(globalTables.whitelistedCIDRs)
      .where(and(
        eq(globalTables.whitelistedCIDRs.cidrBlock, cidrBlock),
        eq(globalTables.whitelistedCIDRs.isActive, true),
      ));

    if (existing.length > 0) {
      throw new HTTPException(400, {
        message: "CIDR block already exists in whitelist",
      });
    }

    // Add to whitelist
    await whitelistService.addCIDRToWhitelist(
      cidrBlock,
      reason || "",
      "Admin",
    );

    useLogger(LoggerLevels.info, {
      message: `CIDR ${cidrBlock} added to whitelist by Admin`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_CIDR_ADD",
      details: { cidrBlock, reason, metadata },
    });

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to add CIDR to whitelist",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_CIDR_ADD_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to add CIDR to whitelist",
      cause: error,
    });
  }
};

/**
 * Handler to remove CIDR from whitelist
 */
export const threatIntelRemoveWhitelistCIDRHandler = async (c: HonoContext) => {
  if (c.req.method !== "DELETE") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const cidr = c.req.param("cidr");

    // Validate CIDR block
    if (!cidr || !IPValidationUtils.isValidCIDR(cidr)) {
      throw new HTTPException(400, {
        message: "Invalid CIDR block format",
      });
    }

    // Remove from whitelist
    await whitelistService.removeCIDRFromWhitelist(cidr);

    useLogger(LoggerLevels.info, {
      message: `CIDR ${cidr} removed from whitelist by Admin`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_CIDR_REMOVE",
      details: { cidr },
    });

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to remove CIDR from whitelist",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "WHITELIST_CIDR_REMOVE_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to remove CIDR from whitelist",
      cause: error,
    });
  }
};

/**
 * Custom Blacklist Handlers
 */

const CUSTOM_BLACKLIST_SOURCE_NAME = "Custom Blacklist";

/**
 * Helper function to get Custom Blacklist source ID
 */
async function getCustomBlacklistSourceId(db: ReturnType<typeof getGlobalDB>): Promise<string> {
  const source = await db
    .select({ id: globalTables.threatSources.id })
    .from(globalTables.threatSources)
    .where(eq(globalTables.threatSources.name, CUSTOM_BLACKLIST_SOURCE_NAME))
    .limit(1);

  if (!source.length) {
    throw new HTTPException(404, { message: "Custom Blacklist source not found. Run seed script." });
  }
  return source[0].id;
}

/**
 * Handler to get custom blacklist entries
 */
export const threatIntelCustomBlacklistEntriesHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();
    const type = c.req.query("type") || "all";
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), ADMIN_PAGINATION_MAX);
    const { offset } = calculatePagination(page, limit, 0);

    const source = await db
      .select({ id: globalTables.threatSources.id })
      .from(globalTables.threatSources)
      .where(eq(globalTables.threatSources.name, CUSTOM_BLACKLIST_SOURCE_NAME))
      .limit(1);

    if (!source.length) {
      const { pagination } = calculatePagination(page, limit, 0);
      return c.json({
        success: true,
        data: {
          entries: [],
          pagination: {
            total: pagination.total,
            page: pagination.page,
            limit: pagination.limit,
            totalPages: pagination.totalPages,
          },
        },
      });
    }

    const sourceId = source[0].id;

    const entries = [];

    if (type === "ip" || type === "all") {
      const ipEntries = await db
        .select({
          id: globalTables.threatIPs.id,
          ipAddress: globalTables.threatIPs.ipAddress,
          riskScore: globalTables.threatIPs.riskScore,
          category: globalTables.threatIPs.category,
          metadata: globalTables.threatIPs.metadata,
          createdAt: globalTables.threatIPs.createdAt,
          updatedAt: globalTables.threatIPs.updatedAt,
        })
        .from(globalTables.threatIPs)
        .where(and(
          eq(globalTables.threatIPs.sourceId, sourceId),
          eq(globalTables.threatIPs.isActive, true),
        ))
        .limit(limit)
        .offset(offset);

      entries.push(...ipEntries.map((e) => ({
        id: e.id,
        type: "ip" as const,
        value: e.ipAddress,
        reason: (e.metadata as Record<string, unknown>)?.["reason"] as string || undefined,
        riskScore: e.riskScore,
        category: e.category,
        createdAt: new Date(e.createdAt * 1000).toISOString(),
        updatedAt: new Date(e.updatedAt * 1000).toISOString(),
      })));
    }

    if (type === "cidr" || type === "all") {
      const cidrEntries = await db
        .select({
          id: globalTables.threatCIDRs.id,
          cidrBlock: globalTables.threatCIDRs.cidrBlock,
          riskScore: globalTables.threatCIDRs.riskScore,
          category: globalTables.threatCIDRs.category,
          metadata: globalTables.threatCIDRs.metadata,
          createdAt: globalTables.threatCIDRs.createdAt,
          updatedAt: globalTables.threatCIDRs.updatedAt,
        })
        .from(globalTables.threatCIDRs)
        .where(and(
          eq(globalTables.threatCIDRs.sourceId, sourceId),
          eq(globalTables.threatCIDRs.isActive, true),
        ))
        .limit(limit)
        .offset(offset);

      entries.push(...cidrEntries.map((e) => ({
        id: e.id,
        type: "cidr" as const,
        value: e.cidrBlock,
        reason: (e.metadata as Record<string, unknown>)?.["reason"] as string || undefined,
        riskScore: e.riskScore,
        category: e.category,
        createdAt: new Date(e.createdAt * 1000).toISOString(),
        updatedAt: new Date(e.updatedAt * 1000).toISOString(),
      })));
    }

    const [ipTotal, cidrTotal] = await Promise.all([
      db.select({ count: count() }).from(globalTables.threatIPs).where(and(
        eq(globalTables.threatIPs.sourceId, sourceId),
        eq(globalTables.threatIPs.isActive, true),
      )),
      db.select({ count: count() }).from(globalTables.threatCIDRs).where(and(
        eq(globalTables.threatCIDRs.sourceId, sourceId),
        eq(globalTables.threatCIDRs.isActive, true),
      )),
    ]);

    const total = (ipTotal[0]?.count || 0) + (cidrTotal[0]?.count || 0);
    const { pagination } = calculatePagination(page, limit, total);

    return c.json({
      success: true,
      data: {
        entries,
        pagination: {
          total: pagination.total,
          page: pagination.page,
          limit: pagination.limit,
          totalPages: pagination.totalPages,
        },
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to get custom blacklist entries",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_ENTRIES_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to get custom blacklist entries",
      cause: error,
    });
  }
};

/**
 * Handler to add IP to custom blacklist
 */
export const threatIntelAddCustomBlacklistIPHandler = async (c: HonoContext) => {
  if (c.req.method !== "POST") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();
    const sourceId = await getCustomBlacklistSourceId(db);
    const { ipAddress, reason } = await c.req.json();

    // Validate IP
    if (!ipAddress || !IPValidationUtils.isValidIP(ipAddress)) {
      throw new HTTPException(400, { message: "Invalid IP address format" });
    }

    // Use upsert to handle both new entries and reactivation of soft-deleted entries
    // The unique constraint on (ipAddress, sourceId) ensures atomicity
    await db.insert(globalTables.threatIPs).values({
      id: generateIdRandomWithTimestamp(16),
      ipAddress,
      sourceId,
      riskScore: 100,
      category: "malicious",
      metadata: { reason, addedBy: "Admin", addedAt: new Date().toISOString() },
      isActive: true,
    }).onConflictDoUpdate({
      target: [globalTables.threatIPs.ipAddress, globalTables.threatIPs.sourceId],
      set: {
        isActive: true,
        riskScore: 100,
        category: "malicious",
        metadata: { reason, addedBy: "Admin", addedAt: new Date().toISOString(), reactivated: true },
        updatedAt: Math.floor(Date.now() / 1000),
      },
    });

    // Trigger bloom filter update
    await threatIntelligenceService.bloomFilterService.reload();

    useLogger(LoggerLevels.info, {
      message: `IP ${ipAddress} added to custom blacklist by Admin`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_IP_ADD",
      details: { ipAddress, reason },
    });

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to add IP to custom blacklist",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_IP_ADD_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to add IP to custom blacklist",
      cause: error,
    });
  }
};

/**
 * Handler to remove IP from custom blacklist
 */
export const threatIntelRemoveCustomBlacklistIPHandler = async (c: HonoContext) => {
  if (c.req.method !== "DELETE") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();
    const sourceId = await getCustomBlacklistSourceId(db);
    const ip = c.req.param("ip");

    // Validate IP address
    if (!ip || !IPValidationUtils.isValidIP(ip)) {
      throw new HTTPException(400, {
        message: "Invalid IP address format",
      });
    }

    // Deactivate the entry
    await db.update(globalTables.threatIPs)
      .set({ isActive: false })
      .where(and(
        eq(globalTables.threatIPs.ipAddress, ip),
        eq(globalTables.threatIPs.sourceId, sourceId),
      ));

    // Trigger bloom filter update
    await threatIntelligenceService.bloomFilterService.reload();

    useLogger(LoggerLevels.info, {
      message: `IP ${ip} removed from custom blacklist by Admin`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_IP_REMOVE",
      details: { ip },
    });

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to remove IP from custom blacklist",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_IP_REMOVE_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to remove IP from custom blacklist",
      cause: error,
    });
  }
};

/**
 * Handler to add CIDR to custom blacklist
 */
export const threatIntelAddCustomBlacklistCIDRHandler = async (c: HonoContext) => {
  if (c.req.method !== "POST") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();
    const sourceId = await getCustomBlacklistSourceId(db);
    const { cidrBlock, reason } = await c.req.json();

    // Validate CIDR
    if (!cidrBlock || !IPValidationUtils.isValidCIDR(cidrBlock)) {
      throw new HTTPException(400, { message: "Invalid CIDR block format" });
    }

    // Use upsert to handle both new entries and reactivation of soft-deleted entries
    // The unique constraint on (cidrBlock, sourceId) ensures atomicity
    await db.insert(globalTables.threatCIDRs).values({
      id: generateIdRandomWithTimestamp(16),
      cidrBlock,
      sourceId,
      riskScore: 100,
      category: "malicious",
      metadata: { reason, addedBy: "Admin", addedAt: new Date().toISOString() },
      isActive: true,
    }).onConflictDoUpdate({
      target: [globalTables.threatCIDRs.cidrBlock, globalTables.threatCIDRs.sourceId],
      set: {
        isActive: true,
        riskScore: 100,
        category: "malicious",
        metadata: { reason, addedBy: "Admin", addedAt: new Date().toISOString(), reactivated: true },
        updatedAt: Math.floor(Date.now() / 1000),
      },
    });

    // Trigger bloom filter update
    await threatIntelligenceService.bloomFilterService.reload();

    useLogger(LoggerLevels.info, {
      message: `CIDR ${cidrBlock} added to custom blacklist by Admin`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_CIDR_ADD",
      details: { cidrBlock, reason },
    });

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to add CIDR to custom blacklist",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_CIDR_ADD_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to add CIDR to custom blacklist",
      cause: error,
    });
  }
};

/**
 * Handler to remove CIDR from custom blacklist
 */
export const threatIntelRemoveCustomBlacklistCIDRHandler = async (c: HonoContext) => {
  if (c.req.method !== "DELETE") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();
    const sourceId = await getCustomBlacklistSourceId(db);
    const cidr = c.req.param("cidr");

    // Validate CIDR block
    if (!cidr || !IPValidationUtils.isValidCIDR(cidr)) {
      throw new HTTPException(400, {
        message: "Invalid CIDR block format",
      });
    }

    // Deactivate the entry
    await db.update(globalTables.threatCIDRs)
      .set({ isActive: false })
      .where(and(
        eq(globalTables.threatCIDRs.cidrBlock, cidr),
        eq(globalTables.threatCIDRs.sourceId, sourceId),
      ));

    // Trigger bloom filter update
    await threatIntelligenceService.bloomFilterService.reload();

    useLogger(LoggerLevels.info, {
      message: `CIDR ${cidr} removed from custom blacklist by Admin`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_CIDR_REMOVE",
      details: { cidr },
    });

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    useLogger(LoggerLevels.error, {
      message: "Failed to remove CIDR from custom blacklist",
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "CUSTOM_BLACKLIST_CIDR_REMOVE_ERROR",
      details: { error },
    });

    throw new HTTPException(500, {
      message: "Failed to remove CIDR from custom blacklist",
      cause: error,
    });
  }
};
