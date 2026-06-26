/**
 * @file services/threat-intelligence/optimized-data-loader.ts
 * @description Optimized Data Loader service module (threat intelligence)
 */
/**
 * Optimized Data Loader for Threat Intelligence
 *
 * Provides efficient batch loading of threat data for Bloom filter initialization.
 * Refactored to use useLogger and traced for observability.
 */

import { getGlobalDB, globalTables } from "@db/index.ts";
import { count, eq, sql } from "@deps";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface ThreatBatch {
  ips: Array<{
    ipAddress: string;
    riskScore: number;
    sourceName: string;
    category: string;
  }>;
  cidrs: Array<{
    cidrBlock: string;
    riskScore: number;
    sourceName: string;
    category: string;
  }>;
}

interface LoadingStats {
  totalIPs: number;
  totalCIDRs: number;
  batchesProcessed: number;
  loadingTimeMs: number;
}

// ============================================================================
// OPTIMIZED DATA LOADER
// ============================================================================

class OptimizedDataLoader {
  // Lazy: connecting in the field initializer (which runs at construction, and
  // `optimizedDataLoader` is constructed at module top level below) would open a
  // global DB connection at import time — blocking this module from being
  // imported in tests/isolation and racing app bootstrap. Connect on first use.
  private _db: ReturnType<typeof getGlobalDB> | null = null;
  private get db(): ReturnType<typeof getGlobalDB> {
    if (this._db === null) this._db = getGlobalDB();
    return this._db;
  }
  private batchSize = 1000;

  /**
   * Get separate counts for IPs and CIDRs for optimal bloom filter sizing
   */
  async getThreatCounts(): Promise<{ ipCount: number; cidrCount: number }> {
    return await traced("OptimizedDataLoader.getThreatCounts", "service", async () => {
      try {
        const [ipResult, cidrResult] = await Promise.all([
          this.db
            .select({ count: count() })
            .from(globalTables.threatIPs)
            .where(eq(globalTables.threatIPs.isActive, true)),
          this.db
            .select({ count: count() })
            .from(globalTables.threatCIDRs)
            .where(eq(globalTables.threatCIDRs.isActive, true)),
        ]);

        const ipCount = ipResult[0]?.count || 0;
        const cidrCount = cidrResult[0]?.count || 0;

        return { ipCount, cidrCount };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        useLogger(
          LoggerLevels.warn,
          {
            message: "Could not get threat counts",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "THREAT_COUNTS_ERROR",
            details: { error: errorMessage },
          },
          false,
          true,
        );

        return { ipCount: 0, cidrCount: 0 };
      }
    });
  }

  /**
   * Load threat data in batches using cursor-based pagination
   * Efficiently handles large datasets without memory issues
   */
  async loadThreatDataBatches(
    batchProcessor: (
      batch: ThreatBatch,
      batchIndex: number,
      totalBatches: number,
    ) => Promise<void> | void,
  ): Promise<LoadingStats> {
    return await traced("OptimizedDataLoader.loadThreatDataBatches", "service", async (span) => {
      const startTime = Date.now();
      let totalIPs = 0;
      let totalCIDRs = 0;
      let batchesProcessed = 0;

      try {
        const { ipCount, cidrCount } = await this.getThreatCounts();
        const totalCount = ipCount + cidrCount;
        const estimatedTotalBatches = Math.ceil(totalCount / this.batchSize);

        // Load IPs in batches using cursor-based pagination
        const ipStats = await this.loadIPsInBatches(batchProcessor, estimatedTotalBatches);
        totalIPs = ipStats.totalIPs;
        batchesProcessed = ipStats.batchesProcessed;

        // Load CIDRs in batches using cursor-based pagination
        const cidrStats = await this.loadCIDRsInBatches(batchProcessor, batchesProcessed, estimatedTotalBatches);
        totalCIDRs = cidrStats.totalCIDRs;
        batchesProcessed = cidrStats.batchesProcessed;

        const loadingTimeMs = Date.now() - startTime;

        span.attributes["total_ips"] = totalIPs;
        span.attributes["total_cidrs"] = totalCIDRs;
        span.attributes["batches_processed"] = batchesProcessed;
        span.attributes["loading_time_ms"] = loadingTimeMs;

        useLogger(
          LoggerLevels.info,
          {
            message: "Threat data batch loading completed",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "BATCH_LOAD_COMPLETE",
            details: {
              totalIPs,
              totalCIDRs,
              batchesProcessed,
              loadingTimeMs,
            },
          },
          false,
          true,
        );

        return {
          totalIPs,
          totalCIDRs,
          batchesProcessed,
          loadingTimeMs,
        };
      } catch (error) {
        const loadingTimeMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        useLogger(LoggerLevels.error, {
          message: "Error loading threat data",
          section: loggerAppSections.THREAT_INTELLIGENCE,
          messageKey: "BATCH_LOAD_ERROR",
          details: {
            error: errorMessage,
            loadingTimeMs,
            batchesProcessed,
          },
        });

        throw error;
      }
    });
  }

  /**
   * Load IP threats in batches
   */
  private async loadIPsInBatches(
    batchProcessor: (
      batch: ThreatBatch,
      batchIndex: number,
      totalBatches: number,
    ) => Promise<void> | void,
    estimatedTotalBatches: number,
  ): Promise<{ totalIPs: number; batchesProcessed: number }> {
    let totalIPs = 0;
    let batchesProcessed = 0;
    let lastIpId = "";
    let hasMoreIPs = true;

    while (hasMoreIPs) {
      const ipThreats = await this.db
        .select({
          id: globalTables.threatIPs.id,
          ipAddress: globalTables.threatIPs.ipAddress,
          riskScore: globalTables.threatIPs.riskScore,
          sourceName: globalTables.threatSources.name,
          category: globalTables.threatIPs.category,
        })
        .from(globalTables.threatIPs)
        .innerJoin(globalTables.threatSources, eq(globalTables.threatIPs.sourceId, globalTables.threatSources.id))
        .where(
          lastIpId
            ? sql`${globalTables.threatIPs.isActive} = true AND ${globalTables.threatSources.isActive} = true AND ${globalTables.threatIPs.id} > ${lastIpId}`
            : sql`${globalTables.threatIPs.isActive} = true AND ${globalTables.threatSources.isActive} = true`,
        )
        .orderBy(globalTables.threatIPs.id)
        .limit(this.batchSize);

      if (ipThreats.length === 0) {
        hasMoreIPs = false;
        break;
      }

      lastIpId = ipThreats[ipThreats.length - 1].id;

      const ips = ipThreats.map((t) => ({
        ipAddress: t.ipAddress!,
        riskScore: t.riskScore || 50,
        sourceName: t.sourceName || "unknown",
        category: t.category || "threat",
      }));

      const batch: ThreatBatch = { ips, cidrs: [] };
      await batchProcessor(batch, batchesProcessed, estimatedTotalBatches);

      totalIPs += ips.length;
      batchesProcessed++;

      if (ipThreats.length < this.batchSize) {
        hasMoreIPs = false;
      }
    }

    return { totalIPs, batchesProcessed };
  }

  /**
   * Load CIDR threats in batches
   */
  private async loadCIDRsInBatches(
    batchProcessor: (
      batch: ThreatBatch,
      batchIndex: number,
      totalBatches: number,
    ) => Promise<void> | void,
    startingBatchIndex: number,
    estimatedTotalBatches: number,
  ): Promise<{ totalCIDRs: number; batchesProcessed: number }> {
    let totalCIDRs = 0;
    let batchesProcessed = startingBatchIndex;
    let lastCidrId = "";
    let hasMoreCIDRs = true;

    while (hasMoreCIDRs) {
      const cidrThreats = await this.db
        .select({
          id: globalTables.threatCIDRs.id,
          cidrBlock: globalTables.threatCIDRs.cidrBlock,
          riskScore: globalTables.threatCIDRs.riskScore,
          sourceName: globalTables.threatSources.name,
          category: globalTables.threatCIDRs.category,
        })
        .from(globalTables.threatCIDRs)
        .innerJoin(globalTables.threatSources, eq(globalTables.threatCIDRs.sourceId, globalTables.threatSources.id))
        .where(
          lastCidrId
            ? sql`${globalTables.threatCIDRs.isActive} = true AND ${globalTables.threatSources.isActive} = true AND ${globalTables.threatCIDRs.id} > ${lastCidrId}`
            : sql`${globalTables.threatCIDRs.isActive} = true AND ${globalTables.threatSources.isActive} = true`,
        )
        .orderBy(globalTables.threatCIDRs.id)
        .limit(this.batchSize);

      if (cidrThreats.length === 0) {
        hasMoreCIDRs = false;
        break;
      }

      lastCidrId = cidrThreats[cidrThreats.length - 1].id;

      const cidrs = cidrThreats.map((t) => ({
        cidrBlock: t.cidrBlock!,
        riskScore: t.riskScore || 50,
        sourceName: t.sourceName || "unknown",
        category: t.category || "threat",
      }));

      const batch: ThreatBatch = { ips: [], cidrs };
      await batchProcessor(batch, batchesProcessed, estimatedTotalBatches);

      totalCIDRs += cidrs.length;
      batchesProcessed++;

      if (cidrThreats.length < this.batchSize) {
        hasMoreCIDRs = false;
      }
    }

    return { totalCIDRs, batchesProcessed };
  }
}

// Export singleton instance
export const optimizedDataLoader = new OptimizedDataLoader();
