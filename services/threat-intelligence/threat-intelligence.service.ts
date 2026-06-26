/**
 * @file services/threat-intelligence/threat-intelligence.service.ts
 * @description Threat Intelligence service (threat intelligence)
 */
/**
 * Simplified Threat Intelligence Service
 *
 * Main service that consolidates all threat intelligence functionality.
 * Refactored to remove singleton pattern, unify initialization, and simplify control flow.
 */

import { and, count, eq, sql } from "@deps";

import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { generateIdForStorage, generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { IPValidationUtils } from "@utils/network/index.ts";
import { traced } from "@services/tracing/index.ts";

// Import consolidated services
import { BloomFilterService } from "./bloom-filter.service.ts";
import { WhitelistService } from "./whitelist.service.ts";
import { THREAT_INTEL_CONFIG } from "./config.ts";
import { createResult, type ThreatIntelligenceContext, type ThreatIntelligenceResult, validateIPForThreatCheck } from "./helper.ts";
import { analyzeRequestPatterns, determineAction, determineCategory } from "./helper.ts";
import { logFinalDecision, logSecurityEvent } from "./helper.ts";
import { ipMatchesAnyCIDR } from "./helper.ts";

import {
  IThreatBulkImportData,
  IThreatBulkImportResult,
  IThreatCachedResult,
  IThreatDatabaseStats,
} from "@interfaces/threat-intelligence.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { envConfig } from "@config/env.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";

// Re-export types for external use
export type { ThreatIntelligenceContext, ThreatIntelligenceResult };

/**
 * Main Threat Intelligence Service
 * Consolidates all functionality into a single, efficient service
 * Removed singleton pattern for dependency injection
 */
export class ThreatIntelligenceService {
  private db = getGlobalDB();
  private cache: Awaited<ReturnType<typeof getCache>> | null = null;
  private isInitialized = false;
  private useBloomFilter: boolean = THREAT_INTEL_CONFIG.bloom.enabled;
  private whitelistService: WhitelistService;
  public bloomFilterService: BloomFilterService;

  // Bloom freshness state (pull-based, runs in the HTTP isolate). The scheduled
  // threat-intel jobs run in a separate Worker isolate/process and can never
  // reach this singleton, so the HTTP process re-reads the DB's active set
  // itself and reloads only when it changed. The check is request-driven and
  // throttled (see ensureBloomFresh) rather than a background timer, so it
  // works on scale-to-zero deployments where timers don't fire while the
  // isolate is frozen between requests.
  private lastBloomCheckAtMs = 0;
  private lastBloomSignature: string | null = null;
  private bloomReloadInFlight = false;

  constructor(whitelistService?: WhitelistService, bloomFilterService?: BloomFilterService) {
    this.whitelistService = whitelistService || new WhitelistService();
    this.bloomFilterService = bloomFilterService || new BloomFilterService();
  }

  /**
   * Check if service is ready to process requests
   */
  isReady(): boolean {
    return this.isInitialized || !envConfig.threatIntelligence.enabled;
  }

  /**
   * Initialize threat intelligence services
   * Unified initialization - no dual methods
   */
  async initialize(): Promise<void> {
    if (this.isInitialized || !envConfig.threatIntelligence.enabled) return;

    try {
      useLogger(
        LoggerLevels.info,
        {
          message: "Initializing threat intelligence services...",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "INIT_START",
        },
        false,
        true,
      );

      // Initialize cache connection
      this.cache = await getCache();

      // Initialize whitelist service
      await this.whitelistService.loadWhitelistData();

      // Initialize Bloom filter service if enabled
      if (this.useBloomFilter) {
        useLogger(
          LoggerLevels.info,
          {
            message: "Initializing Bloom filter optimization...",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BLOOM_INIT",
          },
          false,
          true,
        );
        await this.bloomFilterService.initialize();

        // Capture the active-set signature the freshly-loaded bloom corresponds
        // to, so the first request doesn't trigger a redundant reload.
        try {
          this.lastBloomSignature = await this.getBloomSignature();
        } catch (error) {
          useLogger(LoggerLevels.warn, {
            message: "Bloom freshness: failed to capture initial signature",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BLOOM_FRESHNESS_INIT_ERROR",
            details: { error: String(error) },
          });
        }
      }

      this.isInitialized = true;
      useLogger(
        LoggerLevels.info,
        {
          message: "Threat intelligence services initialized",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "INIT_COMPLETE",
        },
        false,
        true,
      );
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "❌ Failed to initialize threat intelligence services",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "INIT_FAILED",
        details: { error },
      });
      throw error;
    }
  }

  // ===========================================================================
  // Bloom filter live-reload (pull-based, request-driven, in the HTTP isolate)
  // -------------------------------------------------------------------------
  // The request middleware reads THIS singleton, but the threat-intel jobs run
  // in a separate Worker isolate/process and can never mutate it. So instead of
  // being notified, the HTTP process re-reads the DB's active set — the shared
  // source of truth — on the request path (throttled) and reloads the bloom
  // only when it changed. reload() loads isActive=true only, so one mechanism
  // gives both freshness (newly-active threats) and compaction (deactivated
  // entries drop out).
  //
  // This is intentionally request-driven rather than a background setInterval:
  // on scale-to-zero / request-driven deployments the isolate is frozen or
  // killed between requests, so timers don't fire reliably. Cold starts load
  // the bloom fresh in initialize(); ensureBloomFresh() keeps a long-lived warm
  // isolate from serving a stale active set.
  // ===========================================================================

  /**
   * Whether the in-process bloom freshness check should run. Guarded so dev /
   * disabled deployments don't do work nobody reads (mirrors the conditions
   * under which the middleware actually consults the bloom). Protected so tests
   * can force it on regardless of NODE_ENV.
   */
  protected shouldRunBloomAutoReload(): boolean {
    return this.useBloomFilter && envConfig.threatIntelligence.enabled;
  }

  /**
   * Request-driven, throttled bloom freshness check. Safe to call on every
   * request: at most once per `staleCheckIntervalMs` it re-reads the cheap
   * active-set signature and reloads the bloom only when it changed.
   *
   * Fire-and-forget by design — it never blocks the request and never throws.
   * The request that trips the window may use a marginally-stale bloom; the
   * reload completes in the background and subsequent requests see fresh data.
   * The window is claimed up-front so concurrent requests don't all fire a
   * check, and `maybeReloadBloom`'s in-flight guard prevents stacked reloads.
   */
  ensureBloomFresh(): void {
    if (!this.shouldRunBloomAutoReload()) return;

    const now = Date.now();
    if (now - this.lastBloomCheckAtMs < THREAT_INTEL_CONFIG.bloom.staleCheckIntervalMs) return;

    // Claim the window before the async work so concurrent requests within the
    // same tick don't each kick off a signature read.
    this.lastBloomCheckAtMs = now;

    this.maybeReloadBloom().catch((error) => {
      useLogger(LoggerLevels.error, {
        message: "Bloom freshness check threw unexpectedly",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "BLOOM_FRESHNESS_CHECK_ERROR",
        details: { error: String(error) },
      });
    });
  }

  /**
   * Re-read the active-set signature and reload the bloom only if it changed.
   * The in-flight guard prevents stacked reloads if ticks overlap a slow
   * reload. Never throws — logs and skips so the interval stays alive.
   * Protected so tests can drive it directly.
   */
  protected async maybeReloadBloom(): Promise<void> {
    if (this.bloomReloadInFlight) return;
    this.bloomReloadInFlight = true;
    try {
      const signature = await this.getBloomSignature();
      if (signature === this.lastBloomSignature) return;
      await this.bloomFilterService.reload();
      this.lastBloomSignature = signature;
      useLogger(LoggerLevels.info, {
        message: "Bloom filter reloaded (active-set signature changed)",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "BLOOM_AUTO_RELOADED",
        details: { signature },
      });
    } catch (error) {
      useLogger(LoggerLevels.warn, {
        message: "Bloom auto-reload skipped due to error",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "BLOOM_AUTO_RELOAD_ERROR",
        details: { error: String(error) },
      });
    } finally {
      this.bloomReloadInFlight = false;
    }
  }

  /**
   * Cheap change-detection signature over the active threat set — exactly what
   * reload() loads. MAX(updatedAt) moves on any insert/reactivate/deactivate;
   * COUNT(*) guards the narrow same-second add/remove edge where MAX holds.
   * Scoped to isActive=true so a cleanup hard-delete of an inactive row (which
   * doesn't affect the bloom) can't spuriously trip a reload.
   */
  protected async getBloomSignature(): Promise<string> {
    const toNum = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
    const [ip, cidr] = await Promise.all([
      this.db.select({
        maxUpdated: sql`max(${globalTables.threatIPs.updatedAt})`,
        activeCount: count(),
      }).from(globalTables.threatIPs).where(eq(globalTables.threatIPs.isActive, true)),
      this.db.select({
        maxUpdated: sql`max(${globalTables.threatCIDRs.updatedAt})`,
        activeCount: count(),
      }).from(globalTables.threatCIDRs).where(eq(globalTables.threatCIDRs.isActive, true)),
    ]);
    const ipRow = ip[0];
    const cidrRow = cidr[0];
    return `${toNum(ipRow?.maxUpdated)}|${toNum(ipRow?.activeCount)}|${toNum(cidrRow?.maxUpdated)}|${toNum(cidrRow?.activeCount)}`;
  }

  /**
   * Main IP security check with unified flow
   * Simplified control flow - no nested methods
   */
  async checkIP(
    ip: string,
    context: ThreatIntelligenceContext = {},
  ): Promise<ThreatIntelligenceResult> {
    return await traced("ThreatIntelligenceService.checkIP", "service", async (span) => {
      span.attributes["ip_address"] = ip;
      span.attributes["use_bloom_filter"] = this.useBloomFilter;

      const startTime = performance.now();

      // Allow requests through during warm-up or when disabled
      if (!this.isReady()) {
        span.attributes["warming_up"] = true;
        span.attributes["action"] = "allow";
        return createResult("allow", 0, ["Threat intelligence initializing - request allowed during warm-up"], "clean", {
          isThreat: false,
          isWhitelisted: false,
          isTorNode: false,
          isAnonymizer: false,
          isInfrastructure: false,
          sourceCategories: [],
          sources: [],
        });
      }

      if (!envConfig.threatIntelligence.enabled) {
        span.attributes["dev_mode"] = true;
        span.attributes["action"] = "allow";
        return createResult("allow", 0, ["Development mode - threat intelligence bypassed"], "clean", {
          isThreat: false,
          isWhitelisted: false,
          isTorNode: false,
          isAnonymizer: false,
          isInfrastructure: false,
          sourceCategories: [],
          sources: [],
        });
      }

      // Validate IP first
      const validationResult = validateIPForThreatCheck(ip);
      if (validationResult) {
        validationResult.metadata.performance = {
          totalTimeMs: 0,
          bloomFilterUsed: false,
        };
        return validationResult;
      }

      const _bloomUsed = this.useBloomFilter;

      // Main check logic - unified flow
      let bloomFilterHit = false;
      let _bloomFilterSource: string | undefined;
      let dbQueryTimeMs = 0;
      let cacheQueryTimeMs = 0;

      if (this.useBloomFilter) {
        // Keep the live bloom fresh against DB writes made by the off-isolate
        // jobs. Throttled + fire-and-forget, so it adds no request latency.
        this.ensureBloomFresh();

        // Bloom filter check (O(1) - ultra fast)
        const bloomResult = await this.bloomFilterService.checkIP(ip);
        const bloomTime = performance.now() - startTime;
        bloomFilterHit = bloomResult.isPotentialThreat;
        _bloomFilterSource = bloomResult.source;

        if (!bloomFilterHit) {
          // Not a threat - return early
          span.attributes["action"] = "allow";
          span.attributes["risk_score"] = 0;
          span.attributes["is_threat"] = false;
          span.attributes["total_time_ms"] = Math.round(bloomTime * 100) / 100;

          return createResult(
            "allow",
            0,
            ["Not in threat database"],
            "clean",
            {
              isThreat: false,
              isWhitelisted: false,
              isTorNode: false,
              isAnonymizer: false,
              isInfrastructure: false,
              sourceCategories: [],
              sources: [],
              cacheHit: bloomResult.cacheHit,
              performance: {
                totalTimeMs: Math.round(bloomTime * 100) / 100,
                bloomFilterUsed: true,
                bloomFilterHit: false,
                bloomFilterSource: bloomResult.source,
              },
            },
          );
        }

        // Potential threat detected - verify with database
        const dbStartTime = performance.now();
        const dbResult = await this.performDatabaseLookup(ip);
        dbQueryTimeMs = Math.round((performance.now() - dbStartTime) * 100) / 100;

        if (dbResult.isThreat) {
          // True positive - return result
          const patternRisk = analyzeRequestPatterns(context);
          const riskScore = dbResult.riskScore + patternRisk.riskScore;
          const reasons = [
            `Known malicious IP (${dbResult.sources.join(", ")})`,
            ...patternRisk.reasons,
          ];

          const action = determineAction(riskScore);
          const category = determineCategory(dbResult, riskScore, action);

          // Log final decision for high-risk actions
          await logFinalDecision(action, ip, context, riskScore, reasons);

          span.attributes["action"] = action;
          span.attributes["risk_score"] = riskScore;
          span.attributes["is_threat"] = dbResult.isThreat;
          span.attributes["total_time_ms"] = Math.round((performance.now() - startTime) * 100) / 100;

          return createResult(
            action,
            riskScore,
            reasons,
            category,
            {
              isThreat: dbResult.isThreat,
              isWhitelisted: dbResult.isWhitelisted,
              isTorNode: dbResult.sources.includes("Tor Exit Nodes"),
              isAnonymizer: (dbResult.sourceCategories ?? []).includes("anonymizer"),
              isInfrastructure: (dbResult.sourceCategories ?? []).includes("infrastructure"),
              sourceCategories: dbResult.sourceCategories ?? [],
              sources: dbResult.sources,
              cacheHit: false,
              performance: {
                totalTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
                bloomFilterUsed: true,
                bloomFilterHit: true,
                bloomFilterSource: bloomResult.source,
                dbQueryTimeMs,
              },
            },
          );
        } else {
          // False positive - log and return clean
          useLogger(LoggerLevels.warn, {
            message: `Bloom filter false positive for IP: ${ip} (source: ${bloomResult.source})`,
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BLOOM_FILTER_FALSE_POSITIVE",
            details: {
              ip,
              source: bloomResult.source,
              bloomFilterHit: true,
              dbQueryTimeMs,
            },
          });

          span.attributes["action"] = "allow";
          span.attributes["risk_score"] = 0;
          span.attributes["is_threat"] = false;
          span.attributes["total_time_ms"] = Math.round((performance.now() - startTime) * 100) / 100;

          return createResult(
            "allow",
            0,
            ["False positive filtered"],
            "clean",
            {
              isThreat: false,
              isWhitelisted: false,
              isTorNode: false,
              isAnonymizer: false,
              isInfrastructure: false,
              sourceCategories: [],
              sources: [],
              cacheHit: false,
              performance: {
                totalTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
                bloomFilterUsed: true,
                bloomFilterHit: true,
                bloomFilterSource: bloomResult.source,
                dbQueryTimeMs,
              },
            },
          );
        }
      } else {
        // Traditional cache-based approach
        const cacheStartTime = performance.now();
        const cachedResult = await this.getCachedLookup(ip);
        cacheQueryTimeMs = Math.round((performance.now() - cacheStartTime) * 100) / 100;

        if (cachedResult) {
          // Cache hit - return result
          const processedResult = await this.processResult(ip, context, cachedResult, true);
          processedResult.metadata.performance = {
            totalTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
            bloomFilterUsed: false,
            cacheQueryTimeMs,
          };

          span.attributes["action"] = processedResult.action;
          span.attributes["risk_score"] = processedResult.riskScore;
          span.attributes["is_threat"] = processedResult.metadata.isThreat;
          span.attributes["total_time_ms"] = processedResult.metadata.performance?.totalTimeMs;

          return processedResult;
        }

        // Cache miss - database lookup
        const dbStartTime = performance.now();
        const dbResult = await this.performDatabaseLookup(ip);
        dbQueryTimeMs = Math.round((performance.now() - dbStartTime) * 100) / 100;

        // Cache result
        await this.cacheLookupResult(ip, dbResult);

        const processedResult = await this.processResult(ip, context, dbResult, false);
        processedResult.metadata.performance = {
          totalTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
          bloomFilterUsed: false,
          cacheQueryTimeMs,
          dbQueryTimeMs,
        };

        span.attributes["action"] = processedResult.action;
        span.attributes["risk_score"] = processedResult.riskScore;
        span.attributes["is_threat"] = processedResult.metadata.isThreat;
        span.attributes["total_time_ms"] = processedResult.metadata.performance?.totalTimeMs;

        return processedResult;
      }
    });
  }

  /**
   * Perform database lookup for threat intelligence
   */
  private async performDatabaseLookup(
    ip: string,
  ): Promise<IThreatCachedResult> {
    const result: IThreatCachedResult = {
      isThreat: false,
      isWhitelisted: false,
      riskScore: 0,
      sources: [],
      category: "clean",
      sourceCategories: [],
      cachedAt: Date.now(),
    };

    try {
      // Check if IP is whitelisted (highest priority)
      const whitelistCheck = await this.whitelistService.checkWhitelistStatus(ip);

      // Always check threat status to detect whitelisted threats
      const threatCheck = await this.checkThreatStatus(ip);

      if (whitelistCheck.isWhitelisted) {
        result.isWhitelisted = true;
        result.category = "whitelisted";

        // Log if whitelisted IP is also a known threat
        if (threatCheck.isThreat) {
          result.isThreat = true; // Still mark as threat for metadata
          result.sources = threatCheck.sources;
          result.sourceCategories = threatCheck.sourceCategories;
        }

        return result;
      }

      // Process non-whitelisted threats
      if (threatCheck.isThreat) {
        result.isThreat = true;
        result.riskScore = threatCheck.riskScore;
        result.sources = threatCheck.sources;
        result.category = threatCheck.category;
        result.sourceCategories = threatCheck.sourceCategories;
      }

      return result;
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "Database lookup error",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "DB_LOOKUP_ERROR",
        details: { error },
      });
      return result;
    }
  }

  /**
   * Check if IP is a threat - Direct database lookup
   */
  private async checkThreatStatus(ip: string): Promise<{
    isThreat: boolean;
    riskScore: number;
    sources: string[];
    category: string;
    sourceCategories: string[];
  }> {
    try {
      // Direct database lookup for threat IPs with active status filter
      const threatIPsData = await this.db
        .select({
          ipAddress: globalTables.threatIPs.ipAddress,
          riskScore: globalTables.threatIPs.riskScore,
          category: globalTables.threatIPs.category,
          sourceName: globalTables.threatSources.name,
        })
        .from(globalTables.threatIPs)
        .innerJoin(globalTables.threatSources, eq(globalTables.threatIPs.sourceId, globalTables.threatSources.id))
        .where(and(
          eq(globalTables.threatIPs.ipAddress, ip),
          eq(globalTables.threatIPs.isActive, true),
          eq(globalTables.threatSources.isActive, true),
        ));

      if (threatIPsData.length > 0) {
        // Aggregate results from multiple sources
        const sources = threatIPsData.map((t) => t.sourceName);
        const maxRiskScore = Math.max(
          ...threatIPsData.map((t) => t.riskScore || 50),
        );
        const category = threatIPsData[0].category || "malicious";
        const sourceCategories = [...new Set(threatIPsData.map((t) => t.category).filter((c): c is string => Boolean(c)))];

        return {
          isThreat: true,
          riskScore: maxRiskScore,
          sources: sources,
          category: category,
          sourceCategories,
        };
      }

      const activeCIDRs = await this.db
        .select({
          cidrBlock: globalTables.threatCIDRs.cidrBlock,
          riskScore: globalTables.threatCIDRs.riskScore,
          category: globalTables.threatCIDRs.category,
          sourceName: globalTables.threatSources.name,
        })
        .from(globalTables.threatCIDRs)
        .innerJoin(globalTables.threatSources, eq(globalTables.threatCIDRs.sourceId, globalTables.threatSources.id))
        .where(and(
          eq(globalTables.threatCIDRs.isActive, true),
          eq(globalTables.threatSources.isActive, true),
        ));

      const threatCIDRsData = activeCIDRs.filter((entry) => IPValidationUtils.matchesAnyCIDR(ip, [entry.cidrBlock]));

      if (threatCIDRsData.length > 0) {
        const sources = [...new Set(threatCIDRsData.map((t) => t.sourceName))];
        const maxRiskScore = Math.max(
          ...threatCIDRsData.map((t) => t.riskScore || 50),
        );
        const maxRiskEntry = threatCIDRsData.find((t) => (t.riskScore || 50) === maxRiskScore) ?? threatCIDRsData[0];
        const sourceCategories = [...new Set(threatCIDRsData.map((t) => t.category).filter((c): c is string => Boolean(c)))];

        return {
          isThreat: true,
          riskScore: maxRiskScore,
          sources,
          category: maxRiskEntry.category || "malicious",
          sourceCategories,
        };
      }

      return { isThreat: false, riskScore: 0, sources: [], category: "clean", sourceCategories: [] };
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: `❌ Database threat lookup ERROR for IP ${ip}`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "DB_THREAT_LOOKUP_ERROR",
        details: {
          ip,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return { isThreat: false, riskScore: 0, sources: [], category: "clean", sourceCategories: [] };
    }
  }

  /**
   * Process the lookup result and create final response
   */
  private async processResult(
    ip: string,
    context: ThreatIntelligenceContext,
    dbResult: IThreatCachedResult,
    cacheHit: boolean,
  ): Promise<ThreatIntelligenceResult> {
    const reasons: string[] = [];
    let riskScore = dbResult.riskScore;

    if (dbResult.isWhitelisted) {
      reasons.push("IP whitelisted");

      // Log if whitelisted IP is also a known threat
      if (dbResult.isThreat) {
        await logSecurityEvent(
          "WHITELISTED_THREAT_IP_ACCESS",
          "medium",
          {
            ip,
            context,
            riskScore,
            sources: dbResult.sources,
          },
        );
      }
    } else if (dbResult.isThreat) {
      reasons.push(`Known malicious IP (${dbResult.sources.join(", ")})`);
    }

    // Analyze request patterns for additional risk
    const patternRisk = analyzeRequestPatterns(context);
    if (patternRisk.isSuspicious) {
      reasons.push(...patternRisk.reasons);
      riskScore += patternRisk.riskScore;
    }

    const action = determineAction(riskScore);
    const category = determineCategory(
      dbResult,
      riskScore,
      action,
    );

    // Log final decision for high-risk actions
    await logFinalDecision(
      action,
      ip,
      context,
      riskScore,
      reasons,
    );

    return createResult(
      action,
      riskScore,
      reasons,
      category,
      {
        isThreat: dbResult.isThreat,
        isWhitelisted: dbResult.isWhitelisted,
        isTorNode: dbResult.sources.includes("Tor Exit Nodes"),
        isAnonymizer: (dbResult.sourceCategories ?? []).includes("anonymizer"),
        isInfrastructure: (dbResult.sourceCategories ?? []).includes("infrastructure"),
        sourceCategories: dbResult.sourceCategories ?? [],
        sources: dbResult.sources,
        cacheHit,
      },
    );
  }

  /**
   * Get cached lookup result for an IP
   */
  private async getCachedLookup(
    ip: string,
  ): Promise<IThreatCachedResult | null> {
    try {
      if (!this.cache) return null;

      const cached = await this.cache.get<IThreatCachedResult>(
        CACHE_NAMESPACES.THREAT_INTELLIGENCE.LOOKUP_CACHE,
        ip,
      );

      // Check if cache entry is still valid
      if (
        cached &&
        (Date.now() - cached.cachedAt) <
          (THREAT_INTEL_CONFIG.cache.lookupTtlSeconds * 1000)
      ) {
        return cached;
      }

      return null;
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "Cache lookup error",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "CACHE_LOOKUP_ERROR",
        details: { error },
      });
      return null;
    }
  }

  /**
   * Cache lookup result for an IP
   */
  private async cacheLookupResult(
    ip: string,
    result: IThreatCachedResult,
  ): Promise<void> {
    try {
      if (!this.cache) return;

      result.cachedAt = Date.now();
      await this.cache.set(
        CACHE_NAMESPACES.THREAT_INTELLIGENCE.LOOKUP_CACHE,
        ip,
        result,
        { ttl: THREAT_INTEL_CONFIG.cache.lookupTtlSeconds },
      );
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "Failed to cache lookup result",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "CACHE_SET_ERROR",
        details: { error },
      });
    }
  }

  /**
   * Refresh threat intelligence data
   */
  async refreshCache(): Promise<void> {
    try {
      useLogger(LoggerLevels.info, {
        message: "🔄 Refreshing threat intelligence data...",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "REFRESH_START",
      });

      // Refresh whitelist service
      await this.whitelistService.refresh();

      // Bloom filters don't need rebuilding during refresh
      if (this.useBloomFilter) {
        useLogger(LoggerLevels.info, {
          message: "🔬 Bloom filters remain optimized - no rebuild needed",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "BLOOM_NO_REBUILD",
        });
      }

      useLogger(LoggerLevels.info, {
        message: "✅ Threat intelligence data refreshed",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "REFRESH_COMPLETE",
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add IP to whitelist
   */
  async addToWhitelist(
    ip: string,
    reason: string,
    addedBy: string,
  ): Promise<void> {
    try {
      await this.whitelistService.addIPToWhitelist(ip, reason, addedBy);
      useLogger(LoggerLevels.info, {
        message: `✅ Added IP ${ip} to whitelist (${reason})`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "WHITELIST_ADD",
        details: { ip, reason, addedBy },
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Remove IP from whitelist
   */
  async removeFromWhitelist(ip: string): Promise<void> {
    try {
      await this.whitelistService.removeIPFromWhitelist(ip);
      useLogger(LoggerLevels.info, {
        message: `✅ Removed IP ${ip} from whitelist`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "WHITELIST_REMOVE",
        details: { ip },
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if an IP matches any CIDR ranges in threat database
   * Useful for debugging false positives
   */
  async checkIPAgainstCIDRRanges(ip: string): Promise<{
    matchingCidrs: string[];
    count: number;
    cidrs: Array<{ cidrBlock: string; sourceName: string; riskScore: number; category: string }>;
  }> {
    const matchingCidrs: string[] = [];
    const cidrs: Array<{ cidrBlock: string; sourceName: string; riskScore: number; category: string }> = [];

    try {
      const cidrData = await this.db
        .select({
          cidrBlock: globalTables.threatCIDRs.cidrBlock,
          sourceName: globalTables.threatSources.name,
          riskScore: globalTables.threatCIDRs.riskScore,
          category: globalTables.threatCIDRs.category,
        })
        .from(globalTables.threatCIDRs)
        .innerJoin(globalTables.threatSources, eq(globalTables.threatCIDRs.sourceId, globalTables.threatSources.id))
        .where(and(
          eq(globalTables.threatCIDRs.isActive, true),
          eq(globalTables.threatSources.isActive, true),
        ));

      for (const threat of cidrData) {
        if (ipMatchesAnyCIDR(ip, [threat.cidrBlock])) {
          matchingCidrs.push(threat.cidrBlock);
          cidrs.push({
            cidrBlock: threat.cidrBlock,
            sourceName: threat.sourceName,
            riskScore: threat.riskScore || 50,
            category: threat.category || "malicious",
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to check CIDR ranges for ${ip}:`, error);
    }

    return {
      matchingCidrs,
      count: matchingCidrs.length,
      cidrs,
    };
  }

  /**
   * Get comprehensive service statistics
   */
  async getServiceStats(): Promise<{
    isInitialized: boolean;
    useBloomFilter: boolean;
    cacheStats: Record<string, unknown>;
    dbStats: IThreatDatabaseStats;
    whitelistStats: Record<string, unknown>;
    bloomStats?: Record<string, unknown>;
  }> {
    const dbStats = await this.getIThreatDatabaseStats();
    const whitelistStats = this.whitelistService.getWhitelistStats();

    const result = {
      isInitialized: this.isInitialized,
      useBloomFilter: this.useBloomFilter,
      cacheStats: {}, // NOTE: cache statistics not yet instrumented; this.cache?.getStats() is available but unwired here
      dbStats,
      whitelistStats: whitelistStats as unknown as Record<string, unknown>,
    } as {
      isInitialized: boolean;
      useBloomFilter: boolean;
      cacheStats: Record<string, unknown>;
      dbStats: IThreatDatabaseStats;
      whitelistStats: Record<string, unknown>;
      bloomStats?: Record<string, unknown>;
    };

    // Add Bloom filter statistics if enabled
    if (this.useBloomFilter) {
      try {
        const bloomServiceStatus = this.bloomFilterService.getStatus();
        result.bloomStats = {
          isInitialized: bloomServiceStatus.isInitialized,
          memoryUsageMB: bloomServiceStatus.memoryUsageMB,
          metrics: bloomServiceStatus.metrics,
          filters: bloomServiceStatus.filters,
        };
      } catch (error) {
        useLogger(LoggerLevels.error, {
          message: "Failed to get Bloom filter stats",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "BLOOM_STATS_ERROR",
          details: { error },
        });
        result.bloomStats = {
          error: "Failed to retrieve Bloom filter statistics",
        };
      }
    }

    return result;
  }

  /**
   * Get database statistics
   */
  private async getIThreatDatabaseStats(): Promise<IThreatDatabaseStats> {
    const dbStats = {
      totalThreatIPs: 0,
      totalThreatCIDRs: 0,
      totalWhitelistedIPs: 0,
      totalWhitelistedCIDRs: 0,
      activeSources: 0,
    };

    try {
      const [
        threatIPCount,
        threatCIDRCount,
        whitelistIPCount,
        whitelistCIDRCount,
        sourceCount,
      ] = await Promise.all([
        this.db.select({ count: count() }).from(globalTables.threatIPs).where(
          eq(globalTables.threatIPs.isActive, true),
        ),
        this.db.select({ count: count() }).from(globalTables.threatCIDRs)
          .where(eq(globalTables.threatCIDRs.isActive, true)),
        this.db.select({ count: count() }).from(globalTables.whitelistedIPs)
          .where(eq(globalTables.whitelistedIPs.isActive, true)),
        this.db.select({ count: count() }).from(globalTables.whitelistedCIDRs)
          .where(eq(globalTables.whitelistedCIDRs.isActive, true)),
        this.db.select({ count: count() }).from(globalTables.threatSources)
          .where(eq(globalTables.threatSources.isActive, true)),
      ]);

      dbStats.totalThreatIPs = threatIPCount[0]?.count || 0;
      dbStats.totalThreatCIDRs = threatCIDRCount[0]?.count || 0;
      dbStats.totalWhitelistedIPs = whitelistIPCount[0]?.count || 0;
      dbStats.totalWhitelistedCIDRs = whitelistCIDRCount[0]?.count || 0;
      dbStats.activeSources = sourceCount[0]?.count || 0;
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "Failed to get database stats",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "DB_STATS_ERROR",
        details: { error },
      });
    }

    return dbStats;
  }

  /**
   * Bulk import threat intelligence data from external sources
   */
  async bulkImportThreatData(
    data: IThreatBulkImportData,
  ): Promise<IThreatBulkImportResult> {
    const result: IThreatBulkImportResult = {
      sourcesCreated: 0,
      ipsImported: 0,
      cidrsImported: 0,
      errors: [],
    };
    try {
      useLogger(LoggerLevels.info, {
        message: "🔄 Starting bulk import of threat intelligence data...",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "BULK_IMPORT_START",
      });

      // Process each source
      for (const sourceData of data.sources) {
        try {
          useLogger(LoggerLevels.info, {
            message: `📡 Processing source: ${sourceData.name}`,
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BULK_IMPORT_SOURCE",
            details: { source: sourceData.name },
          });

          // Create or update threat source
          const sourceId = generateIdRandomWithTimestamp(16);
          const existingSources = await this.db
            .select()
            .from(globalTables.threatSources)
            .where(eq(globalTables.threatSources.name, sourceData.name))
            .limit(1);

          let actualSourceId: string;

          if (existingSources.length > 0) {
            // Update existing source
            actualSourceId = existingSources[0].id;
            await this.db
              .update(globalTables.threatSources)
              .set({
                description: sourceData.description,
                url: sourceData.url,
                totalEntries: sourceData.ips.length + sourceData.cidrs.length,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(globalTables.threatSources.id, actualSourceId));
          } else {
            // Create new source
            actualSourceId = sourceId;
            await this.db.insert(globalTables.threatSources).values({
              id: actualSourceId,
              name: sourceData.name,
              description: sourceData.description ||
                `Threat intelligence from ${sourceData.name}`,
              url: sourceData.url,
              isActive: true,
              updateFrequency: 24, // Daily updates
              totalEntries: sourceData.ips.length + sourceData.cidrs.length,
            });
            result.sourcesCreated++;
          }

          // Only clear existing data if we have replacement data
          const totalNewEntries = sourceData.ips.length +
            sourceData.cidrs.length;
          if (totalNewEntries > 0) {
            await this.db
              .delete(globalTables.threatIPs)
              .where(eq(globalTables.threatIPs.sourceId, actualSourceId));

            await this.db
              .delete(globalTables.threatCIDRs)
              .where(eq(globalTables.threatCIDRs.sourceId, actualSourceId));
          } else {
            useLogger(LoggerLevels.warn, {
              message: `⚠️  Skipping data clear for ${sourceData.name} - no replacement data available`,
              section: loggerAppSections.THREAT_INTELLIGENCE,
              messageKey: "BULK_IMPORT_SKIP_CLEAR",
              details: { source: sourceData.name },
            });
          }

          // Bulk upsert IPs in batches
          // The unique constraint on (ipAddress, sourceId) enables atomic reactivation
          if (sourceData.ips.length > 0) {
            const ipBatches = this.chunkArray(sourceData.ips, 1000);

            for (const batch of ipBatches) {
              const ipRecords = batch.map((ipData) => ({
                id: generateIdForStorage(),
                ipAddress: ipData.ip,
                sourceId: actualSourceId,
                riskScore: ipData.riskScore,
                category: ipData.category,
                isActive: true,
                metadata: {
                  importedAt: new Date().toISOString(),
                  source: sourceData.name,
                },
              }));

              await this.db.insert(globalTables.threatIPs).values(ipRecords).onConflictDoUpdate({
                target: [globalTables.threatIPs.ipAddress, globalTables.threatIPs.sourceId],
                set: {
                  isActive: true,
                  riskScore: sql`EXCLUDED.risk_score`,
                  category: sql`EXCLUDED.category`,
                  updatedAt: Math.floor(Date.now() / 1000),
                },
              });
              result.ipsImported += batch.length;
            }
          }

          // Bulk upsert CIDRs in batches
          // The unique constraint on (cidrBlock, sourceId) enables atomic reactivation
          if (sourceData.cidrs.length > 0) {
            const cidrBatches = this.chunkArray(sourceData.cidrs, 1000);

            for (const batch of cidrBatches) {
              const cidrRecords = batch.map((cidrData) => ({
                id: generateIdForStorage(),
                cidrBlock: cidrData.cidr,
                sourceId: actualSourceId,
                riskScore: cidrData.riskScore,
                category: cidrData.category,
                isActive: true,
                metadata: {
                  importedAt: new Date().toISOString(),
                  source: sourceData.name,
                  estimatedHosts: this.estimateHostsInCIDR(cidrData.cidr),
                },
              }));

              await this.db.insert(globalTables.threatCIDRs).values(cidrRecords).onConflictDoUpdate({
                target: [globalTables.threatCIDRs.cidrBlock, globalTables.threatCIDRs.sourceId],
                set: {
                  isActive: true,
                  riskScore: sql`EXCLUDED.risk_score`,
                  category: sql`EXCLUDED.category`,
                  updatedAt: Math.floor(Date.now() / 1000),
                },
              });
              result.cidrsImported += batch.length;
            }
          }

          useLogger(LoggerLevels.info, {
            message: `✅ Imported ${sourceData.ips.length} IPs and ${sourceData.cidrs.length} CIDRs from ${sourceData.name}`,
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BULK_IMPORT_SOURCE_COMPLETE",
            details: { source: sourceData.name, ips: sourceData.ips.length, cidrs: sourceData.cidrs.length },
          });
        } catch (error) {
          const errorMsg = `Error processing source ${sourceData.name}: ${error instanceof Error ? error.message : String(error)}`;
          useLogger(LoggerLevels.error, {
            message: `❌ ${errorMsg}`,
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BULK_IMPORT_SOURCE_ERROR",
            details: { source: sourceData.name, error },
          });
          result.errors.push(errorMsg);
        }
      }

      // Refresh services after import
      await this.refreshCache();

      // Reload Bloom filters if enabled (reload() always rebuilds, initialize() skips if already initialized)
      if (this.useBloomFilter) {
        await this.bloomFilterService.reload();
      }

      useLogger(LoggerLevels.info, {
        message:
          `🎉 Bulk import completed: ${result.sourcesCreated} sources created, ${result.ipsImported} IPs imported, ${result.cidrsImported} CIDRs imported`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "BULK_IMPORT_COMPLETE",
        details: { sourcesCreated: result.sourcesCreated, ipsImported: result.ipsImported, cidrsImported: result.cidrsImported },
      });
      // Log security event for audit trail
      await logSecurityEvent(
        "BULK_IMPORT_COMPLETED",
        "medium",
        {
          action: "bulk_threat_import",
          sourcesCreated: result.sourcesCreated,
          ipsImported: result.ipsImported,
          cidrsImported: result.cidrsImported,
          errors: result.errors.length,
        },
      );
    } catch (error) {
      const errorMsg = `Critical error during bulk import: ${error instanceof Error ? error.message : String(error)}`;
      useLogger(LoggerLevels.error, {
        message: `❌ ${errorMsg}`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "BULK_IMPORT_CRITICAL_ERROR",
        details: { error },
      });
      result.errors.push(errorMsg);

      await logSecurityEvent(
        "BULK_IMPORT_FAILED",
        "high",
        {
          action: "bulk_threat_import_failed",
          error: errorMsg,
        },
      );
    }

    return result;
  }

  /**
   * Helper method to chunk arrays for batch processing
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Estimate number of hosts in a CIDR block
   */
  private estimateHostsInCIDR(cidr: string): number {
    const [, prefixStr] = cidr.split("/");
    const prefix = parseInt(prefixStr, 10);
    const hostBits = 32 - prefix;
    return Math.pow(2, hostBits) - 2; // Subtract network and broadcast addresses
  }
}
