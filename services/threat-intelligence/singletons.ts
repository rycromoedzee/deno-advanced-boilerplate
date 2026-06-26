/**
 * @file services/threat-intelligence/singletons.ts
 * @description Lazy singletons for threat intelligence services
 */
/**
 * Threat Intelligence Service Singletons
 *
 * Provides singleton getters for dependency injection.
 * Following the project pattern for service instantiation.
 */

import { BloomFilterService } from "./bloom-filter.service.ts";
import { WhitelistService } from "./whitelist.service.ts";
import { ThreatSourceUpdateService } from "./threat-source-update.service.ts";
import { ThreatIntelligenceService } from "./threat-intelligence.service.ts";

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

let bloomFilterService: BloomFilterService | undefined;
let whitelistService: WhitelistService | undefined;
let threatSourceUpdateService: ThreatSourceUpdateService | undefined;
let threatIntelligenceService: ThreatIntelligenceService | undefined;

// ============================================================================
// SINGLETON GETTERS
// ============================================================================

/**
 * Get the BloomFilterService singleton
 */
export function getBloomFilterService(): BloomFilterService {
  if (!bloomFilterService) {
    bloomFilterService = new BloomFilterService();
  }
  return bloomFilterService;
}

/**
 * Get the WhitelistService singleton
 */
export function getWhitelistService(): WhitelistService {
  if (!whitelistService) {
    whitelistService = new WhitelistService();
  }
  return whitelistService;
}

/**
 * Get the ThreatSourceUpdateService singleton
 */
export function getThreatSourceUpdateService(): ThreatSourceUpdateService {
  if (!threatSourceUpdateService) {
    threatSourceUpdateService = new ThreatSourceUpdateService();
  }
  return threatSourceUpdateService;
}

/**
 * Get the ThreatIntelligenceService singleton
 */
export function getThreatIntelligenceService(): ThreatIntelligenceService {
  if (!threatIntelligenceService) {
    threatIntelligenceService = new ThreatIntelligenceService(
      getWhitelistService(),
      getBloomFilterService(),
    );
  }
  return threatIntelligenceService;
}

// ============================================================================
// RESET FUNCTIONS (for testing)
// ============================================================================

/**
 * Reset all singletons (useful for testing)
 */
export function resetSingletons(): void {
  bloomFilterService = undefined;
  whitelistService = undefined;
  threatSourceUpdateService = undefined;
  threatIntelligenceService = undefined;
}
