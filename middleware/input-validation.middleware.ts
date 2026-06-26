/**
 * @file middleware/input-validation.middleware.ts
 * @description Input Validation middleware
 */
/**
 * Input Validation Middleware
 *
 * Provides JSON validation with security threat detection for:
 * - SQL Injection
 * - XSS (Cross-Site Scripting)
 * - Command Injection
 * - Path Traversal
 * - Oversized requests
 */

import type { HonoContext, HonoNext } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";

export interface InputValidationOptions {
  /**
   * Enable or disable the entire input validation middleware.
   * When false, all validation (size checks, threat detection, JSON parsing) is skipped.
   * Defaults to true.
   */
  enabled?: boolean;

  /**
   * Maximum JSON body size in bytes
   */
  maxBodySize?: number;

  /**
   * Enable security threat detection
   */
  enableThreatDetection?: boolean;
}

/**
 * Field names that should skip ALL threat detection.
 * Passwords and similar credential fields may legitimately contain
 * special characters like $, @, !, etc. that would otherwise trigger
 * command injection or other false positives.
 */
const SKIP_ALL_THREATS_FIELD_NAMES = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "oldPassword",
]);

const SAFE_FIELD_NAMES = new Set([
  // Identifiers
  "id",
  "uid",
  "uuid",
  "userId",
  "userIds",
  "attemptId",
  "requestId",
  "sessionId",
  "transactionId",
  "correlationId",
  "traceId",
  "spanId",
  // Tokens and keys
  "token",
  "accessToken",
  "refreshToken",
  "recoveryToken",
  "emailToken",
  "verifiedToken",
  "resetToken",
  "csrfToken",
  "apiKey",
  "secret",
  "nonce",
  // Encoded data
  "credential",
  "rawId",
  "authenticatorData",
  "clientDataJSON",
  "signature",
  "userHandle",
  "attestationObject",
  // Hashes and signatures
  "hash",
  "signature",
  "checksum",
  "etag",
  // Base64/encoded content
  "payload",
  "data",
  "encoded",
  "challenge",
]);

// Security threat patterns
const THREAT_PATTERNS = {
  SQL_INJECTION: [
    /('|\\')|(;|\\;)|(--|\/\*)|\b(ALTER|CREATE|DELETE|DROP|EXEC(UTE)?|INSERT|MERGE|SELECT|UNION|UPDATE)\b/i,
    /\b(OR|AND)\b.*(=|<|>|!=)/i,
    /UNION\s+(ALL\s+)?SELECT/i,
  ],
  XSS: [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /on(load|error|click|mouseover|focus|blur)\s*=/gi,
    /<(img|svg|object|embed)[^>]*>/gi,
  ],
  COMMAND_INJECTION: [
    /[;&|`$(){}[\]]/,
    /\b(cat|ls|pwd|whoami|id|uname|ps|netstat|ifconfig|ping|curl|wget|nc|nmap)\b/i,
  ],
  PATH_TRAVERSAL: [
    /\.\.\//,
    /\.\.\\/,
    /%2e%2e%2f/i,
    /%2e%2e%5c/i,
  ],
};

/**
 * Check if text contains security threats
 * @param text - The text to scan
 * @param skipSqlInjection - Whether to skip SQL injection checks (for safe fields)
 */
function detectThreats(text: string, skipSqlInjection = false): string[] {
  const threats: string[] = [];

  for (const [threatType, patterns] of Object.entries(THREAT_PATTERNS)) {
    // Skip SQL injection checks for fields known to contain random/encoded data
    if (skipSqlInjection && threatType === "SQL_INJECTION") {
      continue;
    }

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        threats.push(threatType);
        // Log which pattern matched for debugging
        console.log("[INPUT_VALIDATION] Pattern match:", {
          threatType,
          pattern: pattern.toString(),
          textPreview: text.substring(0, 50),
          skipSqlInjection,
        });
        break;
      }
    }
  }

  return threats;
}

/**
 * Check if a field name is in the safe list (should skip SQL injection checks)
 */
function isSafeFieldName(fieldName: string): boolean {
  return SAFE_FIELD_NAMES.has(fieldName);
}

/**
 * Recursively scan object for threats
 * @param obj - The object to scan
 * @param path - Current path in the object (for debugging)
 * @param parentKey - The parent field name (used to determine if this is a safe field)
 */
function scanObjectForThreats(obj: unknown, path = "", parentKey = ""): string[] {
  const threats: string[] = [];

  if (typeof obj === "string") {
    // Skip ALL threat detection for password-like fields (they may contain special chars)
    if (SKIP_ALL_THREATS_FIELD_NAMES.has(parentKey)) {
      return threats;
    }
    // Skip SQL injection checks if the parent field is in the safe list
    const skipSqlInjection = isSafeFieldName(parentKey);
    threats.push(...detectThreats(obj, skipSqlInjection));
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      threats.push(...scanObjectForThreats(item, `${path}[${index}]`, parentKey));
    });
  } else if (obj && typeof obj === "object") {
    Object.entries(obj).forEach(([key, value]) => {
      threats.push(
        ...scanObjectForThreats(value, path ? `${path}.${key}` : key, key),
      );
    });
  }

  return threats;
}

/**
 * Simple JSON validation middleware with security threat detection
 */
export function inputValidationMiddleware(
  options: InputValidationOptions = {},
) {
  const {
    enabled = true,
    maxBodySize = 1 * 1024 * 1024, // 1MB default
    enableThreatDetection = true,
  } = options;

  return async (c: HonoContext, next: HonoNext) => {
    if (!enabled) {
      return await next();
    }

    const contentType = c.req.header("content-type");
    const contentLength = c.req.header("content-length");

    // Check JSON body size
    if (contentType?.includes("application/json") && contentLength) {
      const size = parseInt(contentLength);
      if (size > maxBodySize) {
        throwHttpError("COMMON.TOO_LARGE");
      }
    }

    // Check query parameters for threats
    if (enableThreatDetection) {
      const url = new URL(c.req.url);
      if (url.search) {
        const aggregated: Record<string, string | string[]> = {};
        for (const [key, value] of url.searchParams.entries()) {
          const existing = aggregated[key];
          if (existing === undefined) {
            aggregated[key] = value;
          } else if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            aggregated[key] = [existing, value];
          }
        }

        const threats = scanObjectForThreats(aggregated);
        if (threats.length > 0) {
          // Log the detected threats for debugging
          console.log("[INPUT_VALIDATION] Threat detected in query params:", {
            threats,
            queryParams: Object.fromEntries(url.searchParams),
            path: c.req.path,
            method: c.req.method,
          });
          throwHttpError("VALIDATION.MALFORMED_REQUEST");
        }
      }
    }

    // Validate JSON body
    if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
      if (contentType?.includes("application/json")) {
        try {
          const cloned = c.req.raw.clone();
          const rawText = await cloned.text();
          const trimmed = rawText.trim();

          // Allow empty JSON bodies (e.g. refresh endpoint uses cookies only)
          if (trimmed.length > 0) {
            const body = JSON.parse(trimmed);

            // Security threat detection
            if (enableThreatDetection) {
              const threats = scanObjectForThreats(body);
              if (threats.length > 0) {
                // Log the detected threats for debugging
                console.log("[INPUT_VALIDATION] Threat detected in request body:", {
                  threats,
                  body: JSON.stringify(body).substring(0, 200), // Truncate for log safety
                  path: c.req.path,
                  method: c.req.method,
                });
                throwHttpError("VALIDATION.MALFORMED_REQUEST");
              }
            }
          }
        } catch (error) {
          if (error instanceof AppHttpException) throw error;
          throwHttpError("VALIDATION.INVALID_JSON");
        }
      }
    }

    await next();
  };
}

/**
 * API endpoints validation - 2MB limit with threat detection
 */
export function apiInputValidationMiddleware() {
  return inputValidationMiddleware({
    enabled: false,
    maxBodySize: 2 * 1024 * 1024, // 2MB
    enableThreatDetection: true,
  });
}

/**
 * Auth endpoints validation - 512KB limit with strict threat detection
 */
export function authInputValidationMiddleware() {
  return inputValidationMiddleware({
    enabled: false,
    maxBodySize: 512 * 1024, // 512KB
    enableThreatDetection: true,
  });
}
