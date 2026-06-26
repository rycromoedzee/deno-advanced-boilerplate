/**
 * @file services/threat-intelligence/threat-source-update.service.ts
 * @description Threat Source Update service (threat intelligence)
 */
/**
 * Simplified Threat Source Update Service
 *
 * Handles fetching, parsing, and updating threat intelligence sources in database.
 * Compares new data with existing records to add, update, or remove entries.
 * Logs all update activities to threatUpdateLog table.
 *
 * OPTIMIZATIONS:
 * - Uses getGlobalDB() for background job connection pooling
 * - Incremental bloom filter updates (no full rebuilds)
 * - Chunked memory loading (handles millions of IPs without OOM)
 * - Transaction wrapping (ensures atomicity)
 * - Batch operations (maximizes DB performance)
 * - Simplified parser system using parser-utils
 */

import { eq } from "@deps";

import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getThreatSourceByName, IPSUM_THREAT_LEVEL } from "@constants/threat-intelligence.ts";
import {
  fetchJSONWithTimeout,
  fetchWithTimeout,
  parseAbuseIPDBBlocklist,
  parseDataPlaneList,
  parseDShieldBlockList,
  parseIpsumList,
  parsePlainTextList,
  parseSpamhausDropList,
  parseThreatFoxJSON,
  parseURLhausList,
} from "./parser-utils.ts";
import { processCIDRUpdates, processIPUpdates } from "./db-utils.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";

export interface ThreatSourceUpdateResult {
  sourceId: string;
  sourceName: string;
  status: "success" | "failed" | "partial";
  entriesAdded: number;
  entriesUpdated: number;
  entriesRemoved: number;
  durationMs: number;
  errorMessage?: string;
}

export interface ParsedThreatData {
  ips: Set<string>;
  cidrs: Set<string>;
}

export interface ThreatSourceParser {
  name: string;
  url: string;
  fetch: () => Promise<ParsedThreatData>;
  riskScore: number;
  category: string;
}

export class ThreatSourceUpdateService {
  private db = getGlobalDB();

  /**
   * Update all active threat sources
   */
  async updateAllSources(): Promise<ThreatSourceUpdateResult[]> {
    const startTime = performance.now();
    const results: ThreatSourceUpdateResult[] = [];

    try {
      const activeSources = await this.db
        .select()
        .from(globalTables.threatSources)
        .where(eq(globalTables.threatSources.isActive, true));

      useLogger(LoggerLevels.info, {
        message: `🚀 Starting update for ${activeSources.length} active threat sources`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "UPDATE_ALL_START",
      });

      for (const source of activeSources) {
        const result = await this.updateSourceById(source.id);
        results.push(result);
      }

      const totalDuration = performance.now() - startTime;
      const successCount = results.filter((r) => r.status === "success").length;
      const failedCount = results.filter((r) => r.status === "failed").length;
      const totalAdded = results.reduce((sum, r) => sum + r.entriesAdded, 0);
      const totalUpdated = results.reduce((sum, r) => sum + r.entriesUpdated, 0);
      const totalRemoved = results.reduce((sum, r) => sum + r.entriesRemoved, 0);

      useLogger(LoggerLevels.info, {
        message: `✅ Completed update for all threat sources`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "UPDATE_ALL_COMPLETE",
        details: {
          totalDurationMs: Math.round(totalDuration),
          sourceCount: activeSources.length,
          successCount,
          failedCount,
          totalAdded,
          totalUpdated,
          totalRemoved,
        },
      });

      return results;
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "❌ Failed to update all threat sources",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "UPDATE_ALL_FAILED",
        details: { error },
      });
      throw error;
    }
  }

  /**
   * Update a specific source by its ID
   */
  async updateSourceById(sourceId: string): Promise<ThreatSourceUpdateResult> {
    const startTime = performance.now();
    let sourceName = "Unknown";

    try {
      const source = await this.db
        .select()
        .from(globalTables.threatSources)
        .where(eq(globalTables.threatSources.id, sourceId))
        .limit(1);

      if (source.length === 0) {
        throw new Error(`Source with ID ${sourceId} not found`);
      }

      const sourceData = source[0];
      sourceName = sourceData.name;

      // Skip sources with null, undefined, or empty URL (e.g., Custom Blacklist managed internally)
      if (sourceData.url === null || sourceData.url === undefined || sourceData.url === "") {
        const durationMs = performance.now() - startTime;
        const result: ThreatSourceUpdateResult = {
          sourceId,
          sourceName,
          status: "success",
          entriesAdded: 0,
          entriesUpdated: 0,
          entriesRemoved: 0,
          durationMs,
        };

        return result;
      }

      // Get the appropriate parser
      const parser = this.getParserForSource(sourceName, sourceData.url);
      if (!parser) {
        throw new Error(`No parser found for source: ${sourceName}`);
      }

      // Fetch and parse data
      const newData = await parser.fetch();

      // Process updates in DB with chunked loading and transactions
      const stats = await this.processSourceDataUpdate(sourceId, newData, parser.riskScore, parser.category);

      const durationMs = performance.now() - startTime;
      const result: ThreatSourceUpdateResult = {
        sourceId,
        sourceName,
        status: "success",
        ...stats,
        durationMs,
      };

      // Log to threatUpdateLog
      await this.logUpdateActivity(result);

      // Update total entries in threatSources
      await this.db
        .update(globalTables.threatSources)
        .set({
          totalEntries: newData.ips.size + newData.cidrs.size,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(globalTables.threatSources.id, sourceId));

      useLogger(LoggerLevels.info, {
        message: `✅ ${sourceName} update complete`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "UPDATE_SOURCE_COMPLETE",
        details: {
          sourceId,
          sourceName,
          durationMs: Math.round(durationMs),
          added: stats.entriesAdded,
          updated: stats.entriesUpdated,
          removed: stats.entriesRemoved,
          totalEntries: newData.ips.size + newData.cidrs.size,
        },
      });

      return result;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const result: ThreatSourceUpdateResult = {
        sourceId,
        sourceName,
        status: "failed",
        entriesAdded: 0,
        entriesUpdated: 0,
        entriesRemoved: 0,
        durationMs,
        errorMessage,
      };

      await this.logUpdateActivity(result);

      useLogger(LoggerLevels.warn, {
        message: `❌ Failed to update ${sourceName}`,
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "UPDATE_SOURCE_FAILED",
        details: { sourceId, sourceName, error: errorMessage },
      });

      return result;
    }
  }

  /**
   * Process data update for a source
   * Compares new data with existing records
   * Optimized with:
   * - Chunked memory loading (prevents OOM on large datasets)
   * - Transaction wrapping (ensures atomicity)
   * - Batch operations (maximizes DB performance)
   */
  private async processSourceDataUpdate(
    sourceId: string,
    newData: ParsedThreatData,
    riskScore: number,
    category: string,
  ): Promise<{ entriesAdded: number; entriesUpdated: number; entriesRemoved: number }> {
    // Process in transaction for atomicity
    return await this.db.transaction(async (tx) => {
      // 1. Handle IPs with chunked loading
      const ipStats = await processIPUpdates(
        tx,
        globalTables.threatIPs,
        sourceId,
        newData.ips,
        riskScore,
        category,
      );

      // 2. Handle CIDRs with chunked loading
      const cidrStats = await processCIDRUpdates(
        tx,
        globalTables.threatCIDRs,
        sourceId,
        newData.cidrs,
        riskScore,
        category,
      );

      return {
        entriesAdded: ipStats.added + cidrStats.added,
        entriesUpdated: ipStats.updated + cidrStats.updated,
        entriesRemoved: ipStats.removed + cidrStats.removed,
      };
    });
  }

  /**
   * Log update activity to threatUpdateLog table
   */
  private async logUpdateActivity(result: ThreatSourceUpdateResult): Promise<void> {
    try {
      await databaseCreateWithRetry(async (newId) => {
        await this.db.insert(globalTables.threatUpdateLog).values({
          id: newId,
          sourceId: result.sourceId,
          updateType: "full",
          status: result.status,
          entriesAdded: result.entriesAdded,
          entriesUpdated: result.entriesUpdated,
          entriesRemoved: result.entriesRemoved,
          errorMessage: result.errorMessage,
          duration: Math.round(result.durationMs),
          metadata: {
            timestamp: new Date().toISOString(),
            sourceName: result.sourceName,
          },
        });
        return newId;
      }, () => generateIdRandomWithTimestamp(16));
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "Failed to log threat update activity",
        section: loggerAppSections.THREAT_INTELLIGENCE,
        messageKey: "UPDATE_LOG_FAILED",
        details: { sourceId: result.sourceId, sourceName: result.sourceName, error },
      });
    }
  }

  /**
   * Get appropriate parser for a source
   * Simplified to use parser-utils functions
   */
  private getParserForSource(name: string, url: string): ThreatSourceParser | null {
    const riskScore = this.calculateRiskScoreForSource(name);
    const category = this.getCategoryForSource(name);

    // AbuseIPDB Blocklist parser (borestad/blocklist-abuseipdb format)
    if (name === "AbuseIPDB Score 100") {
      return {
        name,
        url,
        riskScore,
        category,
        fetch: async () => {
          const text = await fetchWithTimeout(url);
          return parseAbuseIPDBBlocklist(text);
        },
      };
    }

    if (name === "Spamhaus DROP" || name === "Spamhaus EDROP") {
      return {
        name,
        url,
        riskScore,
        category,
        fetch: async () => {
          const text = await fetchWithTimeout(url);
          return parseSpamhausDropList(text);
        },
      };
    }

    if (name === "DShield 7d") {
      return {
        name,
        url,
        riskScore,
        category,
        fetch: async () => {
          const text = await fetchWithTimeout(url);
          return url.includes("feeds.dshield.org") ? parseDShieldBlockList(text) : parsePlainTextList(text);
        },
      };
    }

    // DataPlane.org feeds are pipe-delimited (IP is the 3rd field), so they
    // need a dedicated parser rather than the whole-line plain-text parser.
    if (name.startsWith("DataPlane")) {
      return {
        name,
        url,
        riskScore,
        category,
        fetch: async () => {
          const text = await fetchWithTimeout(url);
          return parseDataPlaneList(text);
        },
      };
    }

    // Plain text parser for most sources
    if (
      [
        "Binary Defense",
        "Blocklist.de",
        "BruteforceBlocker",
        "C2 Tracker",
        "CINS Bad Guys",
        "CleanTalk",
        "CyberCure",
        "DroneBL",
        "ET Compromised",
        "Feodo Tracker",
        "FireHOL",
        "GreenSnow",
        "MalTrail",
        "ProjectHoneypot",
        "StopForumSpam",
        "Team Cymru",
        "Tor Exit Nodes",
      ].some((n) => name.includes(n))
    ) {
      return {
        name,
        url,
        riskScore,
        category,
        fetch: async () => {
          const text = await fetchWithTimeout(url);
          return parsePlainTextList(text);
        },
      };
    }

    // Ipsum parser
    if (name === "Ipsum.txt") {
      return {
        name,
        url,
        riskScore,
        category,
        fetch: async () => {
          const text = await fetchWithTimeout(url);
          return parseIpsumList(text, IPSUM_THREAT_LEVEL);
        },
      };
    }

    // ThreatFox parser
    if (name === "ThreatFox IPs") {
      return {
        name,
        url,
        riskScore,
        category,
        fetch: async () => {
          const json = await fetchJSONWithTimeout<Record<string, Array<{ ioc_value: string }>>>(url);
          return parseThreatFoxJSON(json);
        },
      };
    }

    // URLhaus parser
    if (name === "URLhaus IPs") {
      return {
        name,
        url,
        riskScore,
        category,
        fetch: async () => {
          const text = await fetchWithTimeout(url);
          return parseURLhausList(text);
        },
      };
    }

    return null;
  }

  private calculateRiskScoreForSource(sourceName: string): number {
    // Try to get risk score from constants first
    const source = getThreatSourceByName(sourceName);
    if (source) {
      return source.riskScore;
    }

    // Fallback for sources not in constants (legacy/custom sources)
    return 50;
  }

  private getCategoryForSource(sourceName: string): string {
    // Try to get category from constants first
    const source = getThreatSourceByName(sourceName);
    if (source) {
      return source.category;
    }

    // Fallback for sources not in constants (legacy/custom sources)
    return "malicious";
  }
}

// Note: Instantiate your own instance or use dependency injection
