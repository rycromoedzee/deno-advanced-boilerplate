/**
 * @file services/threat-intelligence/index.ts
 * @description Barrel exports for threat intelligence services
 */
/**
 * Threat Intelligence Service - Refactored Exports
 *
 * Exports simplified implementations for threat intelligence.
 * Clean API following project guidelines with proper dependency injection.
 */

// ============================================================================
// MAIN EXPORTS
// ============================================================================

// Main service and types
export { type ThreatIntelligenceContext, type ThreatIntelligenceResult, ThreatIntelligenceService } from "./threat-intelligence.service.ts";

// Singleton getters for dependency injection
export {
  getBloomFilterService,
  getThreatIntelligenceService,
  getThreatSourceUpdateService,
  getWhitelistService,
  resetSingletons,
} from "./singletons.ts";

// Specialized services
export { type BloomFilterMetrics, BloomFilterService, type HealthCheckResult, type InitializationResult } from "./bloom-filter.service.ts";
export { type WhitelistCheckResult, WhitelistService, type WhitelistStats } from "./whitelist.service.ts";
export { type ThreatSourceUpdateResult, ThreatSourceUpdateService } from "./threat-source-update.service.ts";

// Configuration
export { THREAT_INTEL_CONFIG, type ThreatIntelligenceConfig } from "./config.ts";

// Utilities and helpers (types are re-exported from threat-intelligence.service.ts)
export {
  analyzeRequestPatterns,
  calculateCIDRRange,
  createResult,
  determineAction,
  determineCategory,
  estimateHostsInCIDR,
  ipMatchesAnyCIDR,
  logFinalDecision,
  logSecurityEvent,
  sanitizeRequestForLogging,
  shouldExpandCIDR,
  validateIPForThreatCheck,
} from "./helper.ts";

// Database utilities
export {
  batchInsert,
  batchUpdate,
  chunkArray,
  type DrizzleTransaction,
  getActiveCount,
  loadRecordsInChunks,
  processCIDRUpdates,
  processIPUpdates,
  type UpdateStats,
} from "./db-utils.ts";

// Parser utilities
export {
  fetchJSONWithTimeout,
  fetchWithTimeout,
  parseAbuseIPDBBlocklist,
  parseIpsumList,
  parsePlainTextList,
  type ParserConfig,
  parseThreatFoxJSON,
  parseURLhausList,
} from "./parser-utils.ts";

// Data loader
export { optimizedDataLoader, type ThreatBatch } from "./optimized-data-loader.ts";

// Export interfaces
export type {
  IThreatBulkImportData,
  IThreatBulkImportResult,
  IThreatCachedResult,
  IThreatDatabaseStats,
} from "@interfaces/threat-intelligence.ts";
