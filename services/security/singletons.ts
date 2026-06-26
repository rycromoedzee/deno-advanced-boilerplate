/**
 * @file services/security/singletons.ts
 * @description Singleton instance management for security services
 *
 * Note: Most security services (EnhancedCSPService) use static methods
 * and don't require instance management. This file provides a consistent
 * pattern for the codebase and can be extended for stateful services.
 */

import { EnhancedCSPService } from "./enhanced-csp.service.ts";

// Singleton instance for CSP service (if needed for stateful operations)
let cspServiceInstance: EnhancedCSPService | null = null;

/**
 * Get the singleton EnhancedCSPService instance.
 * Note: Most CSP methods are static, but this provides instance access if needed.
 * @returns The CSP service instance
 */
export function getEnhancedCSPService(): EnhancedCSPService {
  if (!cspServiceInstance) {
    cspServiceInstance = new EnhancedCSPService();
  }
  return cspServiceInstance;
}

// Re-export threat intelligence singleton getters for convenience
export { getThreatIntelligenceService } from "../threat-intelligence/singletons.ts";
