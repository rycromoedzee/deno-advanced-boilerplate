/**
 * @file services/session/session-api-key.service.ts
 * @description API key validation and management services for session handling
 *
 * SECURITY NOTE: Timing Attack Protection
 * =======================================
 * This service does NOT use explicit timing attack protection (secureApiKeyValidation)
 * because API key validation already has inherent timing variability due to:
 * 1. Cache lookups (Redis) have variable latency
 * 2. Database queries only occur on cache miss
 * 3. Rate limiting adds variable delays
 * 4. Multiple validation checks (IP, domain restrictions) add variable time
 *
 * The constant-time comparison is used where it matters most: comparing the
 * hashed API key (via tokenHashString) which uses crypto.subtle.digest.
 */
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { useSessionLogSecurityEvent } from "./session-security-validation.service.ts";
import { SessionRateLimiter } from "./session-rate-limit.service.ts";
import { getSessionRateLimiter } from "./singletons.ts";

import { ISessionCachedApiKeyData } from "@interfaces/session.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { tokenHashString } from "@services/token/index.ts";
import { useValidateDomainAgainstAllowList, useValidateIpAgainstAllowList } from "@utils/security-check.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getTimeNow, getTimeNowForStorage } from "@utils/shared/index.ts";
import { and, eq } from "@deps";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import type { Span } from "@interfaces/tracing.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

// Constants for security limits
const API_KEY_CACHE_TTL = 15 * 60; // 15 minutes (same as JWT auth)

/**
 * Service for validating API keys and managing their cached data
 */
export class SessionAPIKeyValidationService {
  private rateLimiterService: SessionRateLimiter;

  constructor() {
    // Use singleton getter for consistent rate limiter instance
    this.rateLimiterService = getSessionRateLimiter();
  }

  /**
   * Validates if an API key is valid and can be used
   * @param apiKey - The API key token to validate
   * @param clientIp - Optional client IP for IP restriction validation
   * @param clientDomain - Optional client domain for domain restriction validation
   * @returns Promise<{ userId: string; environmentId: string }> - User ID and environment ID
   */
  async validateApiKey(
    apiKey: string,
    clientIp?: string,
    clientDomain?: string,
  ): Promise<{ userId: string; environmentId: string }> {
    return await tracedWithServiceErrorHandling(
      "SessionAPIKeyValidation.validateApiKey",
      {
        service: "SessionAPIKeyValidationService",
        method: "validateApiKey",
        section: loggerAppSections.SESSION,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        span.attributes["has_client_ip"] = !!clientIp;
        span.attributes["has_client_domain"] = !!clientDomain;

        // Validate API key format
        if (!apiKey || typeof apiKey !== "string") {
          span.attributes["validation_failed"] = "invalid_format";
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        const keyHash = tokenHashString(apiKey);
        span.attributes["key_hash_prefix"] = keyHash.substring(0, 10) + "...";

        const cache = await getCache();

        // Try to get cached API key data first
        const cachedData = await cache.get<ISessionCachedApiKeyData>(
          CACHE_NAMESPACES.AUTH.API_KEY,
          keyHash,
        );

        span.attributes["cache_hit"] = !!cachedData;

        let record: ISessionCachedApiKeyData;

        if (cachedData) {
          // Use cached data
          record = cachedData;
        } else {
          // Cache miss - fetch from database with tracing
          const apiKeyRecord = await traced(
            "SessionAPIKeyValidation.fetchApiKey",
            "db.query",
            async () => {
              const db = await getTenantDB();
              return db
                .select()
                .from(tenantTables.apiKeys)
                .where(eq(tenantTables.apiKeys.keyHash, keyHash))
                .limit(1);
            },
          );

          if (!apiKeyRecord || apiKeyRecord.length === 0) {
            // Rate limit failed validation attempts (brute force protection)
            await this.handleFailedValidationAttempt(clientIp);

            span.attributes["validation_failed"] = "key_not_found";
            await logSecurityEvent("API_KEY_INVALID", {
              keyHash: keyHash.substring(0, 10) + "...",
            });

            throwHttpError("AUTH.UNAUTHORIZED");
          }

          const dbRecord = apiKeyRecord[0];

          // Parse restrictions from database
          const { ipRestrictions, domainRestrictions } = this.parseRestrictions(dbRecord);

          // Create cached data structure
          record = {
            userId: dbRecord.userId,
            expiresAt: dbRecord.expiresAt,
            ipRestrictions,
            domainRestrictions,
            hashedKey: dbRecord.keyHash,
          };

          // Cache the API key data for future requests (only if valid)
          if (
            dbRecord.isActive &&
            (!dbRecord.expiresAt || dbRecord.expiresAt > getTimeNow())
          ) {
            await cache.set(
              CACHE_NAMESPACES.AUTH.API_KEY,
              keyHash,
              record,
              { ttl: API_KEY_CACHE_TTL },
            );
          }
        }

        // Note: If API key is in cache, it's already validated as active
        // Inactive keys are never cached and always hit the database

        // Check if API key has expired
        if (record.expiresAt && record.expiresAt < getTimeNow()) {
          // Remove expired key from cache to prevent repeated lookups
          await cache.delete(CACHE_NAMESPACES.AUTH.API_KEY, keyHash);

          // Rate limit failed validation attempts (expired key abuse protection)
          await this.handleFailedValidationAttempt(clientIp);

          span.attributes["validation_failed"] = "key_expired";
          await logSecurityEvent("API_KEY_EXPIRED", {
            keyHash: record.hashedKey,
            expiresAt: record.expiresAt,
          });
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        // Validate IP restrictions if provided
        if (clientIp && record.ipRestrictions) {
          if (!useValidateIpAgainstAllowList(clientIp, record.ipRestrictions)) {
            // Rate limit failed validation attempts (IP restriction bypass attempts)
            await this.handleFailedValidationAttempt(clientIp);

            span.attributes["validation_failed"] = "ip_restriction";
            await logSecurityEvent("API_KEY_IP_RESTRICTION_FAILED", {
              keyHash: record.hashedKey,
              clientIp,
              ipRestrictionCount: record.ipRestrictions.length,
            });
            throwHttpError("AUTH.UNAUTHORIZED");
          }
        }

        // Validate domain restrictions if provided
        if (clientDomain && record.domainRestrictions) {
          if (
            !useValidateDomainAgainstAllowList(
              clientDomain,
              record.domainRestrictions,
            )
          ) {
            // Rate limit failed validation attempts (domain restriction bypass attempts)
            await this.handleFailedValidationAttempt(clientIp);

            span.attributes["validation_failed"] = "domain_restriction";
            await logSecurityEvent("API_KEY_DOMAIN_RESTRICTION_FAILED", {
              keyHash: record.hashedKey,
              clientDomain,
              domainRestrictionCount: record.domainRestrictions.length,
            });
            throwHttpError("AUTH.UNAUTHORIZED");
          }
        }

        // Validate environment ID exists
        if (!record.environmentId) {
          await this.handleFailedValidationAttempt(clientIp);

          span.attributes["validation_failed"] = "missing_environment";
          await logSecurityEvent("API_KEY_MISSING_ENVIRONMENT", {
            keyHash: record.hashedKey,
            userId: record.userId,
          });
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        // Update last used timestamp (only if not from cache to avoid DB hits)
        if (!cachedData) {
          await traced(
            "SessionAPIKeyValidation.updateLastUsed",
            "db.query",
            async () => {
              const db = await getTenantDB();
              return db
                .update(tenantTables.apiKeys)
                .set({ lastUsedAt: getTimeNowForStorage() })
                .where(eq(tenantTables.apiKeys.keyHash, record.hashedKey));
            },
          );
        }

        span.attributes["user_id"] = record.userId;
        span.attributes["environment_id"] = record.environmentId;
        span.attributes["success"] = true;

        return { userId: record.userId, environmentId: record.environmentId };
      },
    );
  }

  /**
   * Parses IP and domain restrictions from a database record
   * @private
   */
  private parseRestrictions(dbRecord: {
    keyHash: string;
    ipRestrictions: unknown;
    domainRestrictions: unknown;
  }): { ipRestrictions: string[] | null; domainRestrictions: string[] | null } {
    let ipRestrictions: string[] | null = null;
    let domainRestrictions: string[] | null = null;

    if (dbRecord.ipRestrictions) {
      try {
        ipRestrictions = typeof dbRecord.ipRestrictions === "string"
          ? JSON.parse(dbRecord.ipRestrictions)
          : Array.isArray(dbRecord.ipRestrictions)
          ? dbRecord.ipRestrictions
          : null;
      } catch (e) {
        useLogger(LoggerLevels.error, {
          message: "Failed to parse IP restrictions",
          messageKey: "api_key.parse_ip_restrictions_failed",
          section: loggerAppSections.SESSION,
          details: { keyHash: dbRecord.keyHash },
          raw: e,
        });
      }
    }

    if (dbRecord.domainRestrictions) {
      try {
        domainRestrictions = typeof dbRecord.domainRestrictions === "string"
          ? JSON.parse(dbRecord.domainRestrictions)
          : Array.isArray(dbRecord.domainRestrictions)
          ? dbRecord.domainRestrictions
          : null;
      } catch (e) {
        useLogger(LoggerLevels.error, {
          message: "Failed to parse domain restrictions",
          messageKey: "api_key.parse_domain_restrictions_failed",
          section: loggerAppSections.SESSION,
          details: { keyHash: dbRecord.keyHash },
          raw: e,
        });
      }
    }

    return { ipRestrictions, domainRestrictions };
  }

  /**
   * Handles failed validation attempts by checking and enforcing rate limits
   * Only called when validation fails to prevent brute force attacks
   * @private
   */
  private async handleFailedValidationAttempt(
    clientIp?: string,
  ): Promise<void> {
    const validationKey = clientIp || "global";

    const rateLimitResult = await this.rateLimiterService.checkRateLimit(
      validationKey,
      "API_KEY_VALIDATION_FAILURES",
    );

    if (!rateLimitResult.allowed) {
      await logSecurityEvent("API_KEY_VALIDATION_FAILURES_RATE_LIMITED", {
        clientIp,
        remainingAttempts: rateLimitResult.remainingAttempts,
        resetTime: rateLimitResult.resetTime,
      });

      throwHttpError("RATE_LIMIT.VALIDATION_ATTEMPTS_EXCEEDED");
    }
  }

  /**
   * Invalidates cached API key data when key is updated/deactivated
   * Call this method when:
   * - API key is deactivated
   * - API key is deleted
   * - IP restrictions are changed
   * - Domain restrictions are changed
   * - Any other API key properties are modified
   *
   * @param apiKeyHash - The hash of the API key to invalidate
   */
  async invalidateApiKeyCache(apiKeyHash: string): Promise<void> {
    return await traced(
      "SessionAPIKeyValidation.invalidateApiKeyCache",
      "cache.delete",
      async (span: Span) => {
        span.attributes["key_hash_prefix"] = apiKeyHash.substring(0, 10) + "...";

        try {
          const cache = await getCache();
          await cache.delete(
            CACHE_NAMESPACES.AUTH.API_KEY,
            apiKeyHash,
          );
          span.attributes["success"] = true;
        } catch (error) {
          span.attributes["success"] = false;
          useLogger(LoggerLevels.error, {
            message: "Failed to invalidate API key cache",
            messageKey: "api_key.cache_invalidation_failed",
            section: loggerAppSections.SESSION,
            details: { apiKeyHash: apiKeyHash.substring(0, 10) + "..." },
            raw: error,
          });
        }
      },
    );
  }
}

/**
 * Service for API key creation and extension operations
 */
export class SessionAPIKeyCreationService {
  private rateLimiterService: SessionRateLimiter;

  constructor() {
    // Use singleton getter for consistent rate limiter instance
    this.rateLimiterService = getSessionRateLimiter();
  }

  /**
   * Extend an API key's expiration date
   * @param apiKeyId - The ID of the API key to extend
   * @param userId - The user ID who owns the API key (for security validation)
   * @param newExpiresAt - New expiration timestamp in unix timestamp seconds
   */
  async extendApiKey(
    apiKeyId: string,
    userId: string,
    newExpiresAt: number,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "SessionAPIKeyCreation.extendApiKey",
      {
        service: "SessionAPIKeyCreationService",
        method: "extendApiKey",
        section: loggerAppSections.SESSION,
        details: { apiKeyId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        span.attributes["api_key_id"] = apiKeyId;
        span.attributes["user_id"] = userId;

        // Validate new expiration is in the future
        const currentTimeSeconds = getTimeNowForStorage();

        if (newExpiresAt <= currentTimeSeconds) {
          span.attributes["validation_failed"] = "expiration_not_in_future";
          throwHttpError("API_KEY.INVALID_EXPIRATION");
        }

        // First verify the API key exists, belongs to the user, and is active
        const apiKeyRecord = await traced(
          "SessionAPIKeyCreation.fetchApiKeyForExtend",
          "db.query",
          async () => {
            const db = await getTenantDB();
            return db
              .select({
                id: tenantTables.apiKeys.id,
                keyHash: tenantTables.apiKeys.keyHash,
                userId: tenantTables.apiKeys.userId,
                isActive: tenantTables.apiKeys.isActive,
                expiresAt: tenantTables.apiKeys.expiresAt,
              })
              .from(tenantTables.apiKeys)
              .where(
                and(
                  eq(tenantTables.apiKeys.id, apiKeyId),
                  eq(tenantTables.apiKeys.userId, userId),
                ),
              )
              .limit(1);
          },
        );

        if (!apiKeyRecord || apiKeyRecord.length === 0) {
          span.attributes["validation_failed"] = "key_not_found";
          throwHttpError("API_KEY.NOT_FOUND");
        }

        const keyRecord = apiKeyRecord[0];

        if (!keyRecord.isActive) {
          span.attributes["validation_failed"] = "key_inactive";
          throwHttpError("API_KEY.INACTIVE");
        }

        // Update the API key expiration in database
        await traced(
          "SessionAPIKeyCreation.updateApiKeyExpiration",
          "db.query",
          async () => {
            const db = await getTenantDB();
            return db
              .update(tenantTables.apiKeys)
              .set({
                expiresAt: newExpiresAt,
              })
              .where(eq(tenantTables.apiKeys.id, apiKeyId));
          },
        );

        // Clear the API key from cache to force refresh with new expiration
        const cache = await getCache();
        await cache.delete(CACHE_NAMESPACES.AUTH.API_KEY, keyRecord.keyHash);

        span.attributes["success"] = true;
      },
    );
  }
}

/**
 * Logs security events with proper formatting and severity classification
 * @param eventType - The type of security event
 * @param details - Additional details about the event
 * @param component - The component logging the event
 */
async function logSecurityEvent(
  eventType: string,
  details: Record<string, unknown>,
  component: string = "SessionService",
): Promise<void> {
  const severity = eventType.includes("FAILED") || eventType.includes("RATE_LIMITED") ? "high" : "medium";

  try {
    await useSessionLogSecurityEvent(
      LoggerLevels.warn,
      component,
      severity,
      eventType,
      details,
    );
  } catch (error) {
    // Use structured logging as fallback instead of console.error
    // This ensures security events are never lost even if the primary logger fails
    useLogger(LoggerLevels.error, {
      message: `Failed to log security event: ${eventType}`,
      messageKey: "session.security_event_log_failed",
      section: loggerAppSections.SESSION,
      details: {
        originalEventType: eventType,
        originalSeverity: severity,
      },
      raw: error,
    });
  }
}
