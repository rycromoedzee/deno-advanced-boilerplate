/**
 * @file utils/shared/constants.ts
 * @description Constants for shared utilities
 */
export const TEXT_CONSTANTS = {
  MAX_INPUT_LENGTH: 10000,
  SPECIAL_CHARS_REGEX: /[^\w\s-]/g,
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  URL_REGEX: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
} as const;

export const IP_CONSTANTS = {
  IPV4_REGEX: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
  // IPv6: Supports full and compressed notation (::)
  IPV6_REGEX:
    /^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::)$/,
  PRIVATE_IP_RANGES: [
    // IPv4 private ranges
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^169\.254\./,
    // IPv6 private/reserved ranges
    /^::1$/, // Loopback
    /^fe80:/i, // Link-local
    /^fc00:/i, // Unique local addresses (ULA)
    /^fd00:/i, // Unique local addresses (ULA)
    /^ff00:/i, // Multicast
    /^::$/, // Unspecified
  ],
} as const;

export const SECURITY_CONSTANTS = {
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
  MAX_REQUESTS_PER_WINDOW: 100,
  SUSPICIOUS_USER_AGENTS: [
    "bot",
    "crawler",
    "spider",
    "scraper",
  ],
} as const;

/**
 * Risk threshold constants used across all security services
 * These define the standard risk scoring thresholds for security decisions
 */
export const THREAT_INTELLIGENCE_RISK_THRESHOLDS = {
  // Core security thresholds - used by threat intelligence and other security services
  MONITOR: 40, // Start monitoring at 40
  CHALLENGE: 60, // Require challenge/additional verification at 60
  BLOCK: 80, // Block request at 80

  // Additional thresholds for specific use cases
  LOW_RISK: 20, // Low risk threshold for early warnings
  MEDIUM_RISK: 50, // Medium risk threshold for enhanced monitoring
  HIGH_RISK: 70, // High risk threshold for elevated security measures
  CRITICAL: 90, // Critical risk threshold for immediate action
  MAX_RISK: 100, // Maximum risk score
} as const;

/**
 * Security action types based on risk thresholds
 */
export const SECURITY_ACTIONS = {
  ALLOW: "allow",
  MONITOR: "monitor",
  CHALLENGE: "challenge",
  BLOCK: "block",
} as const;

export type SecurityAction = typeof SECURITY_ACTIONS[keyof typeof SECURITY_ACTIONS];
