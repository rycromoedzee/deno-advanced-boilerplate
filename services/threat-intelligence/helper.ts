/**
 * @file services/threat-intelligence/helper.ts
 * @description Helper service module (threat intelligence)
 */
/**
 * Threat Intelligence Helper Utilities
 *
 * Consolidated utility functions for threat intelligence.
 * Combines validation, result processing, logging, and CIDR utilities.
 */

import { IPValidationUtils } from "@utils/network/index.ts";
import { useLogger, useLogSecurityEvent } from "@logger/index.ts";
import { loggerAppSections, LoggerLevels } from "@logger/index.ts";
import { THREAT_INTELLIGENCE_RISK_THRESHOLDS } from "@utils/shared/index.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface ThreatIntelligenceResult {
  isAllowed: boolean;
  isSuspicious: boolean;
  action: "allow" | "monitor" | "challenge" | "block";
  riskScore: number;
  reasons: string[];
  category: "clean" | "whitelisted" | "suspicious" | "malicious" | "blocked";
  metadata: {
    isThreat: boolean;
    isWhitelisted: boolean;
    isTorNode: boolean;
    isAnonymizer: boolean;
    isInfrastructure: boolean;
    sourceCategories: string[];
    sources: string[];
    cacheHit?: boolean;
    performance?: {
      totalTimeMs: number;
      bloomFilterUsed: boolean;
      bloomFilterHit?: boolean;
      bloomFilterSource?: string;
      dbQueryTimeMs?: number;
      cacheQueryTimeMs?: number;
    };
  };
}

export interface ThreatIntelligenceContext {
  path?: string;
  method?: string;
  userAgent?: string;
  userId?: string;
  sessionId?: string;
  /** Sanitized preview of request body/query for security analysis */
  requestPreview?: string;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate IP and return early result if invalid or private
 */
export function validateIPForThreatCheck(ip: string): ThreatIntelligenceResult | null {
  // Validate IP format
  if (!IPValidationUtils.isValidIP(ip)) {
    return createResult("block", 100, ["Invalid IP format"], "blocked", {
      isThreat: false,
      isWhitelisted: false,
      isTorNode: false,
      isAnonymizer: false,
      isInfrastructure: false,
      sourceCategories: [],
      sources: [],
    });
  }

  // Skip private IPs
  if (IPValidationUtils.isPrivateIP(ip)) {
    return createResult("allow", 0, ["Private IP range"], "clean", {
      isThreat: false,
      isWhitelisted: false,
      isTorNode: false,
      isAnonymizer: false,
      isInfrastructure: false,
      sourceCategories: [],
      sources: [],
    });
  }

  return null; // IP is valid and public, continue with threat check
}

/**
 * Create standardized threat intelligence result
 */
export function createResult(
  action: ThreatIntelligenceResult["action"],
  riskScore: number,
  reasons: string[],
  category: ThreatIntelligenceResult["category"],
  metadata: ThreatIntelligenceResult["metadata"],
): ThreatIntelligenceResult {
  return {
    isAllowed: action === "allow" || action === "monitor",
    isSuspicious: riskScore >= 40,
    action,
    riskScore: Math.min(riskScore, 100),
    reasons,
    category,
    metadata,
  };
}

// ============================================================================
// REQUEST SANITIZATION
// ============================================================================

/**
 * Sensitive field names that should be redacted in logs
 */
const SENSITIVE_FIELDS = [
  "password",
  "passwordConfirm",
  "currentPassword",
  "newPassword",
  "oldPassword",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "apiSecret",
  "secret",
  "authorization",
  "cookie",
  "session",
  "csrf",
  "otp",
  "totp",
  "recoveryPhrase",
  "mnemonic",
  "privateKey",
  "passphrase",
];

/**
 * Maximum length for request preview
 */
const MAX_PREVIEW_LENGTH = 500;

/**
 * Sanitize a request body or query object for security logging
 * Redacts sensitive fields and truncates long values
 */
export function sanitizeRequestForLogging(
  data: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  const keys = Object.keys(data).slice(0, 20); // Limit to 20 fields

  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()));

    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else {
      const value = data[key];
      if (value === null || value === undefined) {
        sanitized[key] = value;
      } else if (typeof value === "string") {
        // Truncate long strings
        sanitized[key] = value.length > 100 ? value.substring(0, 100) + "...[truncated]" : value;
      } else if (typeof value === "object") {
        // Mark complex objects without recursing
        sanitized[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
      } else {
        sanitized[key] = value;
      }
    }
  }

  try {
    const json = JSON.stringify(sanitized);
    return json.length > MAX_PREVIEW_LENGTH ? json.substring(0, MAX_PREVIEW_LENGTH) + "...[truncated]" : json;
  } catch {
    return "[unable to serialize]";
  }
}

// ============================================================================
// RESULT PROCESSING
// ============================================================================

/**
 * Analyze request patterns for additional risk scoring
 */
export function analyzeRequestPatterns(context: ThreatIntelligenceContext): {
  isSuspicious: boolean;
  reasons: string[];
  riskScore: number;
} {
  const reasons: string[] = [];
  let riskScore = 0;

  if (context.userAgent) {
    const suspiciousPatterns = [
      /sqlmap/i,
      /nikto/i,
      /nmap/i,
      /masscan/i,
      /zap/i,
      /burp/i,
      /dirbuster/i,
      /gobuster/i,
      /curl/i,
      /wget/i,
      /python/i,
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(context.userAgent)) {
        reasons.push("Suspicious user agent detected");
        riskScore += 25;
        break;
      }
    }
  }

  if (context.path) {
    const suspiciousPaths = [
      /\/admin/i,
      /\/wp-admin/i,
      /\/phpmyadmin/i,
      /\/config/i,
      /\/\.env/i,
      /\/\.git/i,
      /\/backup/i,
      /\/database/i,
    ];

    for (const pattern of suspiciousPaths) {
      if (pattern.test(context.path)) {
        reasons.push("Access to sensitive endpoint");
        riskScore += 15;
        break;
      }
    }
  }

  return {
    isSuspicious: reasons.length > 0,
    reasons,
    riskScore,
  };
}

/**
 * Determine action based on risk score using consistent thresholds
 */
export function determineAction(
  riskScore: number,
): "allow" | "monitor" | "challenge" | "block" {
  if (riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.BLOCK) return "block";
  if (riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.CHALLENGE) {
    return "challenge";
  }
  if (riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.MONITOR) {
    return "monitor";
  }
  return "allow";
}

/**
 * Determine category based on database result and risk score
 */
export function determineCategory(
  dbResult: { isThreat: boolean; isWhitelisted: boolean },
  riskScore: number,
  action: string,
): ThreatIntelligenceResult["category"] {
  if (action === "block") return "blocked";
  if (dbResult.isWhitelisted) return "whitelisted";
  if (dbResult.isThreat) return "malicious";
  if (riskScore >= 40) return "suspicious";
  return "clean";
}

// ============================================================================
// LOGGING
// ============================================================================

/**
 * Log security event with consistent format
 */
export async function logSecurityEvent(
  eventType: string,
  severity: "low" | "medium" | "high" | "critical",
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await useLogSecurityEvent(
      LoggerLevels.warn,
      `Threat Intelligence: ${eventType}`,
      severity,
      loggerAppSections.SESSION,
      `THREAT_INTEL.${eventType}`,
      {
        eventType,
        timestamp: new Date().toISOString(),
        component: "ThreatIntelligenceService",
        ...details,
      },
    );
  } catch (error) {
    // Fallback to useLogger if security event logging fails
    useLogger(LoggerLevels.error, {
      message: `Failed to log threat intelligence event: ${eventType}`,
      section: loggerAppSections.THREAT_INTELLIGENCE,
      messageKey: "SECURITY_EVENT_LOG_FAILED",
      details: { eventType, error },
    });
  }
}

/**
 * Log final decision for high-risk actions
 */
export async function logFinalDecision(
  action: string,
  ip: string,
  context: ThreatIntelligenceContext,
  riskScore: number,
  reasons: string[],
): Promise<void> {
  // Determine if this is a known threat based on reasons
  const isMaliciousIP = reasons.some((reason) => reason.includes("Known malicious IP"));

  if (action === "block") {
    await logSecurityEvent(
      isMaliciousIP ? "MALICIOUS_IP_BLOCKED" : "IP_ACCESS_BLOCKED",
      "high",
      createEventDetails(
        ip,
        context,
        riskScore,
        `Blocked - ${reasons.join(", ")}`,
      ),
    );
  } else if (action === "challenge") {
    await logSecurityEvent(
      isMaliciousIP ? "MALICIOUS_IP_CHALLENGE" : "IP_CHALLENGE_REQUIRED",
      "medium",
      createEventDetails(
        ip,
        context,
        riskScore,
        `Challenge required - ${reasons.join(", ")}`,
      ),
    );
  }
}

/**
 * Create consistent event details for logging
 */
function createEventDetails(
  ip: string,
  context: ThreatIntelligenceContext,
  riskScore: number,
  additionalInfo?: string,
): Record<string, unknown> {
  return {
    ip,
    path: context.path,
    method: context.method,
    userAgent: context.userAgent,
    requestPreview: context.requestPreview,
    riskScore,
    userId: context.userId,
    sessionId: context.sessionId ? context.sessionId.toString().substring(0, 8) + "..." : undefined,
    additionalInfo,
  };
}

// ============================================================================
// CIDR UTILITIES
// ============================================================================

/**
 * Determine if a CIDR should be expanded to individual IPs
 * Expand CIDRs with <= 1000 hosts to individual IPs
 */
export function shouldExpandCIDR(cidr: string): boolean {
  const [, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);
  const hostBits = 32 - prefix;
  const estimatedHosts = Math.pow(2, hostBits) - 2;

  return prefix >= 22 && estimatedHosts <= 1000;
}

/**
 * Calculate CIDR network range
 * Returns { start, end } as IP numbers
 */
export function calculateCIDRRange(cidr: string): { start: number; end: number } | null {
  if (!IPValidationUtils.isValidCIDR(cidr)) {
    return null;
  }

  try {
    const [ip, prefixStr] = cidr.split("/");
    const prefix = parseInt(prefixStr, 10);
    const hostBits = 32 - prefix;
    const ipNum = IPValidationUtils.ipToNumber(ip);
    const mask = ~((1 << hostBits) - 1) >>> 0;
    const networkStart = (ipNum & mask) >>> 0;
    const networkEnd = (networkStart + (1 << hostBits) - 1) >>> 0;

    return { start: networkStart, end: networkEnd };
  } catch {
    return null;
  }
}

/**
 * Estimate number of hosts in a CIDR block
 */
export function estimateHostsInCIDR(cidr: string): number {
  const [, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);
  const hostBits = 32 - prefix;
  return Math.pow(2, hostBits) - 2; // Subtract network and broadcast addresses
}

/**
 * Check if an IP matches any CIDR in the list
 */
export function ipMatchesAnyCIDR(ip: string, cidrs: string[]): boolean {
  return IPValidationUtils.matchesAnyCIDR(ip, cidrs);
}
