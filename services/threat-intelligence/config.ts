/**
 * @file services/threat-intelligence/config.ts
 * @description Configuration for threat intelligence services
 */
/**
 * Threat Intelligence Configuration
 *
 * Consolidated configuration with hard-coded technical constants and minimal
 * environment variable usage. Only the system enabled flag is configurable
 * via environment variables.
 *
 * Technical constants (bloom filter, cache settings) are hard-coded
 * for consistency and to reduce deployment complexity.
 *
 * Risk thresholds are managed centrally in utils/shared/constants.ts
 */

import { envConfig } from "@config/env.ts";

/**
 * Configuration interface with all threat intelligence settings
 */
export interface ThreatIntelligenceConfig {
  // Core system settings
  enabled: boolean;

  // Bloom filter optimization settings
  bloom: {
    enabled: boolean;
    falsePositiveRate: number;
    expectedElements: number;
    staleCheckIntervalMs: number;
  };

  // Cache settings
  cache: {
    lookupTtlSeconds: number;
  };
}

/**
 * Load configuration from environment variables with defaults and validation
 */
function loadConfig(): ThreatIntelligenceConfig {
  return {
    // Core system settings
    enabled: true,

    // Bloom filter settings - optimized for performance with reduced false positives
    bloom: {
      enabled: envConfig.cache.bloomFilter,
      falsePositiveRate: 0.005, // 0.5% false positive rate (5x reduction from default)
      expectedElements: 100000, // Expected threat count with buffer
      // Request-driven freshness throttle. The scheduled jobs run in a separate
      // isolate and can't reach the live singleton, so the HTTP process re-reads
      // the DB's active set itself — but lazily, on the request path, at most
      // once per this window (a cheap change-detection guard makes the O(N)
      // reload fire only when the active set actually moved). Using a throttle
      // instead of a background setInterval keeps this working on scale-to-zero
      // deployments where timers don't fire while the isolate is frozen between
      // requests.
      staleCheckIntervalMs: 30 * 60 * 1000, // 30 minutes
    },

    // Cache settings - balanced for performance and freshness
    cache: {
      lookupTtlSeconds: 300, // 5 minute lookup cache
    },
  };
}

// Create and export configuration
export const THREAT_INTEL_CONFIG = loadConfig();
