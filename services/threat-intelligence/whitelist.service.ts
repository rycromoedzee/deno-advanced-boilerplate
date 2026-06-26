/**
 * @file services/threat-intelligence/whitelist.service.ts
 * @description Whitelist service (threat intelligence)
 */
/**
 * Simplified Whitelist Service
 *
 * Optimized whitelist checking with minimal memory overhead for small datasets.
 * Removed singleton pattern for dependency injection.
 * Refactored to use useLogger and traced for observability.
 */

import { count, eq } from "@deps";

import { IPValidationUtils } from "@utils/network/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { calculateCIDRRange } from "./helper.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface WhitelistCheckResult {
  isWhitelisted: boolean;
  reason?: string;
  source: "ip" | "cidr" | "none";
  cacheHit: boolean;
}

export interface WhitelistStats {
  totalIPs: number;
  totalCIDRs: number;
  lastLoadTime: number;
  memoryUsageKB: number;
  cacheHitRate: number;
}

// ============================================================================
// WHITELIST SERVICE
// ============================================================================

/**
 * Optimized whitelist service with minimal memory footprint
 * Uses in-memory Sets for fast lookups on small datasets
 */
export class WhitelistService {
  private db = getGlobalDB();

  // In-memory storage for fast lookups (small datasets)
  private whitelistedIPsSet = new Set<string>();
  private whitelistedCIDRsArray: string[] = [];
  private whitelistReasons = new Map<string, string>();

  // Performance tracking
  private stats = {
    totalLookups: 0,
    cacheHits: 0,
    lastLoadTime: 0,
    loadCount: 0,
  };

  private isLoaded = false;
  private readonly MAX_WHITELIST_SIZE = 10000;

  constructor() {}

  /**
   * Load whitelist data into memory (optimized for small datasets)
   */
  async loadWhitelistData(): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "WhitelistService.loadWhitelistData",
      {
        service: "WhitelistService",
        method: "loadWhitelistData",
        section: loggerAppSections.THREAT_INTELLIGENCE,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const startTime = performance.now();

        // Load whitelisted IPs and CIDRs in parallel
        const [whitelistIPsData, whitelistCIDRsData] = await Promise.all([
          this.db
            .select({
              ipAddress: globalTables.whitelistedIPs.ipAddress,
              reason: globalTables.whitelistedIPs.reason,
            })
            .from(globalTables.whitelistedIPs)
            .where(eq(globalTables.whitelistedIPs.isActive, true)),

          this.db
            .select({
              cidrBlock: globalTables.whitelistedCIDRs.cidrBlock,
              reason: globalTables.whitelistedCIDRs.reason,
            })
            .from(globalTables.whitelistedCIDRs)
            .where(eq(globalTables.whitelistedCIDRs.isActive, true)),
        ]);

        // Check if dataset is reasonable for in-memory storage
        const totalEntries = whitelistIPsData.length + whitelistCIDRsData.length;
        if (totalEntries > this.MAX_WHITELIST_SIZE) {
          useLogger(
            LoggerLevels.warn,
            {
              message: "Large whitelist dataset - consider database-only approach",
              section: loggerAppSections.THREAT_INTELLIGENCE,
              messageKey: "WHITELIST_LARGE_DATASET",
              details: {
                totalEntries,
                maxRecommended: this.MAX_WHITELIST_SIZE,
              },
            },
            false,
            true,
          );
        }

        // Clear existing data
        this.whitelistedIPsSet.clear();
        this.whitelistedCIDRsArray = [];
        this.whitelistReasons.clear();

        // Load IPs into Set for O(1) lookup
        whitelistIPsData.forEach((entry) => {
          this.whitelistedIPsSet.add(entry.ipAddress);
          if (entry.reason) {
            this.whitelistReasons.set(entry.ipAddress, entry.reason);
          }
        });

        // Load CIDRs into Array (small dataset, linear search is acceptable)
        this.whitelistedCIDRsArray = whitelistCIDRsData.map((entry) => {
          if (entry.reason) {
            this.whitelistReasons.set(entry.cidrBlock, entry.reason);
          }
          return entry.cidrBlock;
        });

        this.isLoaded = true;
        this.stats.lastLoadTime = performance.now() - startTime;
        this.stats.loadCount++;

        const memoryKB = this.getEstimatedMemoryUsageKB();

        span.attributes["ip_count"] = whitelistIPsData.length;
        span.attributes["cidr_count"] = whitelistCIDRsData.length;
        span.attributes["load_time_ms"] = this.stats.lastLoadTime;
        span.attributes["memory_kb"] = memoryKB;

        useLogger(
          LoggerLevels.info,
          {
            message: "Whitelist data loaded",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "WHITELIST_LOAD_COMPLETE",
            details: {
              ipCount: whitelistIPsData.length,
              cidrCount: whitelistCIDRsData.length,
              loadTimeMs: Math.round(this.stats.lastLoadTime * 100) / 100,
              memoryKB,
            },
          },
          false,
          true,
        );
      },
    );
  }

  /**
   * Fast whitelist check with minimal overhead
   */
  async checkWhitelistStatus(ip: string): Promise<WhitelistCheckResult> {
    return await traced("WhitelistService.checkWhitelistStatus", "service", async () => {
      this.stats.totalLookups++;

      // Ensure data is loaded
      if (!this.isLoaded) {
        await this.loadWhitelistData();
      }

      // Fast IP lookup using Set (O(1))
      if (this.whitelistedIPsSet.has(ip)) {
        this.stats.cacheHits++;
        return {
          isWhitelisted: true,
          reason: this.whitelistReasons.get(ip),
          source: "ip",
          cacheHit: true,
        };
      }

      // CIDR lookup using optimized matching (O(n) but n is small)
      for (const cidr of this.whitelistedCIDRsArray) {
        if (IPValidationUtils.matchesAnyCIDR(ip, [cidr])) {
          this.stats.cacheHits++;
          return {
            isWhitelisted: true,
            reason: this.whitelistReasons.get(cidr),
            source: "cidr",
            cacheHit: true,
          };
        }
      }

      // Not whitelisted
      return {
        isWhitelisted: false,
        source: "none",
        cacheHit: true,
      };
    });
  }

  /**
   * Batch whitelist check for multiple IPs
   */
  async checkMultipleIPs(
    ips: string[],
  ): Promise<Map<string, WhitelistCheckResult>> {
    return await traced("WhitelistService.checkMultipleIPs", "service", async () => {
      const results = new Map<string, WhitelistCheckResult>();

      // Ensure data is loaded
      if (!this.isLoaded) {
        await this.loadWhitelistData();
      }

      // Process all IPs efficiently
      for (const ip of ips) {
        results.set(ip, await this.checkWhitelistStatus(ip));
      }

      return results;
    });
  }

  /**
   * Add IP to whitelist (with immediate memory update)
   */
  async addIPToWhitelist(
    ip: string,
    reason: string,
    addedBy: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "WhitelistService.addIPToWhitelist",
      {
        service: "WhitelistService",
        method: "addIPToWhitelist",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        details: { ip },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        // Add to database
        await databaseCreateWithRetry(async (newId) => {
          await this.db.insert(globalTables.whitelistedIPs).values({
            id: newId,
            ipAddress: ip,
            reason,
            addedBy,
            isActive: true,
          });
          return newId;
        }, generateIdRandom);

        // Update in-memory cache immediately
        this.whitelistedIPsSet.add(ip);
        if (reason) {
          this.whitelistReasons.set(ip, reason);
        }

        span.attributes["ip"] = ip;
        span.attributes["reason"] = reason;

        useLogger(
          LoggerLevels.info,
          {
            message: "IP added to whitelist",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "WHITELIST_IP_ADDED",
            details: { ip, reason, addedBy },
          },
          false,
          true,
        );
      },
    );
  }

  /**
   * Add CIDR to whitelist (with immediate memory update)
   */
  async addCIDRToWhitelist(
    cidr: string,
    reason: string,
    addedBy: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "WhitelistService.addCIDRToWhitelist",
      {
        service: "WhitelistService",
        method: "addCIDRToWhitelist",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        details: { cidr },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        // Validate CIDR format
        if (!IPValidationUtils.isValidCIDR(cidr)) {
          throw new Error(`Invalid CIDR format: ${cidr}`);
        }

        // Add to database
        await databaseCreateWithRetry(async (newId) => {
          await this.db.insert(globalTables.whitelistedCIDRs).values({
            id: newId,
            cidrBlock: cidr,
            reason,
            addedBy,
            isActive: true,
          });
          return newId;
        }, generateIdRandom);

        // Update in-memory cache immediately
        this.whitelistedCIDRsArray.push(cidr);
        if (reason) {
          this.whitelistReasons.set(cidr, reason);
        }

        span.attributes["cidr"] = cidr;
        span.attributes["reason"] = reason;

        useLogger(
          LoggerLevels.info,
          {
            message: "CIDR added to whitelist",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "WHITELIST_CIDR_ADDED",
            details: { cidr, reason, addedBy },
          },
          false,
          true,
        );
      },
    );
  }

  /**
   * Remove IP from whitelist (with immediate memory update)
   */
  async removeIPFromWhitelist(ip: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "WhitelistService.removeIPFromWhitelist",
      {
        service: "WhitelistService",
        method: "removeIPFromWhitelist",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        details: { ip },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        // Remove from database
        await this.db
          .update(globalTables.whitelistedIPs)
          .set({ isActive: false })
          .where(eq(globalTables.whitelistedIPs.ipAddress, ip));

        // Update in-memory cache immediately
        this.whitelistedIPsSet.delete(ip);
        this.whitelistReasons.delete(ip);

        span.attributes["ip"] = ip;

        useLogger(
          LoggerLevels.info,
          {
            message: "IP removed from whitelist",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "WHITELIST_IP_REMOVED",
            details: { ip },
          },
          false,
          true,
        );
      },
    );
  }

  /**
   * Remove CIDR from whitelist (with immediate memory update)
   */
  async removeCIDRFromWhitelist(cidr: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "WhitelistService.removeCIDRFromWhitelist",
      {
        service: "WhitelistService",
        method: "removeCIDRFromWhitelist",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        details: { cidr },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        // Remove from database
        await this.db
          .update(globalTables.whitelistedCIDRs)
          .set({ isActive: false })
          .where(eq(globalTables.whitelistedCIDRs.cidrBlock, cidr));

        // Update in-memory cache immediately
        const index = this.whitelistedCIDRsArray.indexOf(cidr);
        if (index > -1) {
          this.whitelistedCIDRsArray.splice(index, 1);
        }
        this.whitelistReasons.delete(cidr);

        span.attributes["cidr"] = cidr;

        useLogger(
          LoggerLevels.info,
          {
            message: "CIDR removed from whitelist",
            section: loggerAppSections.THREAT_INTELLIGENCE,
            messageKey: "WHITELIST_CIDR_REMOVED",
            details: { cidr },
          },
          false,
          true,
        );
      },
    );
  }

  /**
   * Get whitelist statistics
   */
  getWhitelistStats(): WhitelistStats {
    const cacheHitRate = this.stats.totalLookups > 0 ? this.stats.cacheHits / this.stats.totalLookups : 0;

    return {
      totalIPs: this.whitelistedIPsSet.size,
      totalCIDRs: this.whitelistedCIDRsArray.length,
      lastLoadTime: this.stats.lastLoadTime,
      memoryUsageKB: this.getEstimatedMemoryUsageKB(),
      cacheHitRate,
    };
  }

  /**
   * Check if whitelist data needs refresh
   */
  async needsRefresh(): Promise<boolean> {
    try {
      // Check if database has more recent data
      const [dbIPCount, dbCIDRCount] = await Promise.all([
        this.db
          .select({ count: count() })
          .from(globalTables.whitelistedIPs)
          .where(eq(globalTables.whitelistedIPs.isActive, true)),

        this.db
          .select({ count: count() })
          .from(globalTables.whitelistedCIDRs)
          .where(eq(globalTables.whitelistedCIDRs.isActive, true)),
      ]);

      const dbTotalIPs = dbIPCount[0]?.count || 0;
      const dbTotalCIDRs = dbCIDRCount[0]?.count || 0;

      // Compare with in-memory counts
      return (
        dbTotalIPs !== this.whitelistedIPsSet.size ||
        dbTotalCIDRs !== this.whitelistedCIDRsArray.length
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      useLogger(LoggerLevels.error, {
        message: "Failed to check whitelist refresh status",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "WHITELIST_REFRESH_CHECK_FAILED",
        details: { error: errorMessage },
      });

      return true; // Refresh on error to be safe
    }
  }

  /**
   * Refresh whitelist data if needed
   */
  async refreshIfNeeded(): Promise<boolean> {
    if (await this.needsRefresh()) {
      await this.loadWhitelistData();
      return true;
    }
    return false;
  }

  /**
   * Force refresh whitelist data
   */
  async refresh(): Promise<void> {
    await this.loadWhitelistData();
  }

  /**
   * Get estimated memory usage in KB
   */
  private getEstimatedMemoryUsageKB(): number {
    // Estimate memory usage for in-memory structures
    let totalBytes = 0;

    // Set of IP addresses (approximate)
    totalBytes += this.whitelistedIPsSet.size * 20; // ~20 bytes per IP string

    // Array of CIDR blocks (approximate)
    totalBytes += this.whitelistedCIDRsArray.length * 25; // ~25 bytes per CIDR string

    // Map of reasons (approximate)
    totalBytes += this.whitelistReasons.size * 50; // ~50 bytes per reason entry

    return totalBytes / 1024;
  }

  /**
   * Clear all cached data (for testing or reset)
   */
  clearCache(): void {
    this.whitelistedIPsSet.clear();
    this.whitelistedCIDRsArray = [];
    this.whitelistReasons.clear();
    this.isLoaded = false;

    // Reset stats
    this.stats = {
      totalLookups: 0,
      cacheHits: 0,
      lastLoadTime: 0,
      loadCount: 0,
    };
  }

  /**
   * Get all whitelisted IPs (for debugging/admin)
   */
  getAllWhitelistedIPs(): string[] {
    return Array.from(this.whitelistedIPsSet);
  }

  /**
   * Get all whitelisted CIDRs (for debugging/admin)
   */
  getAllWhitelistedCIDRs(): string[] {
    return [...this.whitelistedCIDRsArray];
  }

  /**
   * Get whitelist entry details
   */
  getWhitelistDetails(): {
    ips: Array<{ ip: string; reason?: string }>;
    cidrs: Array<{ cidr: string; reason?: string }>;
  } {
    const ips = Array.from(this.whitelistedIPsSet).map((ip) => ({
      ip,
      reason: this.whitelistReasons.get(ip),
    }));

    const cidrs = this.whitelistedCIDRsArray.map((cidr) => ({
      cidr,
      reason: this.whitelistReasons.get(cidr),
    }));

    return { ips, cidrs };
  }

  /**
   * Validate whitelist integrity (kept for admin handlers)
   */
  validateIntegrity(): {
    isValid: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check for invalid IPs
      for (const ip of this.whitelistedIPsSet) {
        if (!IPValidationUtils.isValidIP(ip)) {
          issues.push(`Invalid IP in whitelist: ${ip}`);
        }
      }

      // Check for invalid CIDRs
      for (const cidr of this.whitelistedCIDRsArray) {
        if (!IPValidationUtils.isValidCIDR(cidr)) {
          issues.push(`Invalid CIDR in whitelist: ${cidr}`);
        }
      }

      // Check memory usage
      const memoryKB = this.getEstimatedMemoryUsageKB();
      if (memoryKB > 1000) { // 1MB threshold
        recommendations.push(
          `High memory usage (${memoryKB.toFixed(1)}KB) - consider database-only approach`,
        );
      }

      // Check dataset size
      const totalEntries = this.whitelistedIPsSet.size +
        this.whitelistedCIDRsArray.length;
      if (totalEntries > this.MAX_WHITELIST_SIZE) {
        recommendations.push(
          `Large dataset (${totalEntries} entries) exceeds recommended limit`,
        );
      }

      // Check for overlapping CIDRs
      const overlaps = this.findOverlappingCIDRs();
      if (overlaps.length > 0) {
        issues.push(`Found ${overlaps.length} overlapping CIDR ranges`);
        recommendations.push("Consider consolidating overlapping CIDR ranges");
      }
    } catch (error) {
      issues.push(
        `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      isValid: issues.length === 0,
      issues,
      recommendations,
    };
  }

  /**
   * Find overlapping CIDR ranges
   */
  private findOverlappingCIDRs(): Array<{ cidr1: string; cidr2: string }> {
    const overlaps: Array<{ cidr1: string; cidr2: string }> = [];

    for (let i = 0; i < this.whitelistedCIDRsArray.length; i++) {
      for (let j = i + 1; j < this.whitelistedCIDRsArray.length; j++) {
        const cidr1 = this.whitelistedCIDRsArray[i];
        const cidr2 = this.whitelistedCIDRsArray[j];

        if (this.cidrsOverlap(cidr1, cidr2)) {
          overlaps.push({ cidr1, cidr2 });
        }
      }
    }

    return overlaps;
  }

  /**
   * Check if two CIDRs overlap (simplified implementation)
   */
  private cidrsOverlap(cidr1: string, cidr2: string): boolean {
    const range1 = calculateCIDRRange(cidr1);
    const range2 = calculateCIDRRange(cidr2);

    if (!range1 || !range2) return false;

    // Simple containment check
    return (range1.start >= range2.start && range1.start <= range2.end) ||
      (range2.start >= range1.start && range2.start <= range1.end);
  }

  /**
   * Get performance metrics (kept for admin handlers)
   */
  getPerformanceMetrics(): {
    totalLookups: number;
    cacheHitRate: number;
    averageLoadTime: number;
    memoryEfficiency: number;
  } {
    const cacheHitRate = this.stats.totalLookups > 0 ? this.stats.cacheHits / this.stats.totalLookups : 0;

    const totalEntries = this.whitelistedIPsSet.size +
      this.whitelistedCIDRsArray.length;
    const memoryKB = this.getEstimatedMemoryUsageKB();
    const memoryEfficiency = totalEntries > 0 ? totalEntries / memoryKB : 0; // entries per KB

    return {
      totalLookups: this.stats.totalLookups,
      cacheHitRate,
      averageLoadTime: this.stats.lastLoadTime,
      memoryEfficiency,
    };
  }
}
