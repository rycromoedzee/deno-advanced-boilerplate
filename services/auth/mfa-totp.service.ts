/**
 * @file services/auth/mfa-totp.service.ts
 * @description Mfa Totp service (auth)
 */
import { and, eq } from "@deps";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { loggerAppSections, LoggerLevels, useLogSecurityEvent } from "@logger/index.ts";
import { AppHttpException } from "@utils/http-exception.ts";
import { ensureMinimumProcessingTime, getTimeNow, getTimeNowForStorage, safeEqual, TIMING_PROFILES } from "@utils/shared/index.ts";
import type { IBackupCodeBinaryBlob } from "@interfaces/auth.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { TOTPGenerationService } from "@utils/crypto/totp.ts";
import { BackupCodeGenerationService, DEFAULT_BACKUP_CODE_CONFIG } from "@utils/crypto/backup-codes.ts";
import { AuthServiceCacheKeys, RateLimitingService } from "@utils/auth/index.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

export class AuthTOTPValidationService {
  private static readonly DIGITS = 6;
  private static readonly INTERVAL_SECONDS = 30;
  private static readonly GRACE_PERIOD_SECONDS = 30;
  private static readonly RATE_LIMIT_CONFIG = {
    MAX_ATTEMPTS: 5,
    WINDOW_SECONDS: 5 * 60,
    BLOCK_DURATION_SECONDS: 15 * 60,
  };

  static async validateTwoFactorCode(
    userId: string,
    userProvidedOTP: string,
    secretId?: string, // Optional: specific 2FA secret to validate against
  ): Promise<{ isValid: boolean; secretId?: string }> {
    return await tracedWithServiceErrorHandling(
      "AuthTOTPValidationService.validateTwoFactorCode",
      {
        service: "AuthTOTPValidationService",
        method: "validateTwoFactorCode",
        section: loggerAppSections.AUTH,
        details: { userId, hasSecretId: !!secretId },
      },
      "AUTH.ENCRYPTION_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["has_secret_id"] = !!secretId;

        const startTime = performance.now();

        // Input validation - check length first (cheaper), then format
        if (!userId || !userProvidedOTP) {
          span.attributes["validation_result"] = "invalid_input";
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
          return { isValid: false };
        }

        if (userProvidedOTP.length !== this.DIGITS) {
          span.attributes["validation_result"] = "invalid_length";
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
          return { isValid: false };
        }

        if (!/^[0-9]+$/.test(userProvidedOTP)) {
          span.attributes["validation_result"] = "invalid_format";
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
          return { isValid: false };
        }

        // Check rate limit
        const rateLimitCheck = await RateLimitingService.checkRateLimit(
          userId,
          {
            maxAttempts: this.RATE_LIMIT_CONFIG.MAX_ATTEMPTS,
            windowMs: this.RATE_LIMIT_CONFIG.WINDOW_SECONDS * 1000,
            blockDurationMs: this.RATE_LIMIT_CONFIG.BLOCK_DURATION_SECONDS * 1000,
            enableIPBasedAdjustment: false,
          },
        );

        if (rateLimitCheck?.shouldBlock) {
          span.attributes["validation_result"] = "rate_limited";
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
          return { isValid: false };
        }

        // Get environment ID from global DB
        const globalDb = getGlobalDB();
        const [user] = await globalDb.select({ environmentId: globalTables.users.environmentId })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId))
          .limit(1);

        if (!user) {
          throw new Error(`User not found: ${userId}`);
        }

        // Get current state once
        const cache = await getCache();
        const recentCodesKey = AuthServiceCacheKeys.generateTOTPKey(
          userId,
          "recent-codes",
        );

        // Fetch recent codes
        const recentCodesResult = await cache.get<string[]>(
          CACHE_NAMESPACES.AUTH.TOTP_RECENT_CODES,
          recentCodesKey,
        );

        const recentCodes = recentCodesResult || [];

        if (recentCodes.includes(userProvidedOTP)) {
          span.attributes["validation_result"] = "replay_attack";
          await RateLimitingService.recordAttempt(
            userId,
            {
              maxAttempts: this.RATE_LIMIT_CONFIG.MAX_ATTEMPTS,
              windowMs: this.RATE_LIMIT_CONFIG.WINDOW_SECONDS * 1000,
              blockDurationMs: this.RATE_LIMIT_CONFIG.BLOCK_DURATION_SECONDS * 1000,
              enableIPBasedAdjustment: false,
            },
          );
          await useLogSecurityEvent(
            LoggerLevels.warn,
            "TOTP replay attack detected",
            "high",
            loggerAppSections.AUTH,
            "auth.totp.replay-attack",
            { userId },
          );
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
          return { isValid: false };
        }

        const tenantDb = await getTenantDB(user.environmentId);

        // Build the base query conditions
        const baseConditions = [
          eq(tenantTables.userTwoFactorSecrets.userId, userId),
          eq(tenantTables.userTwoFactorSecrets.isActive, true),
        ];

        // Add secretId filter if provided
        const whereConditions = secretId
          ? and(...baseConditions, eq(tenantTables.userTwoFactorSecrets.id, secretId))
          : and(...baseConditions);

        // Get user's 2FA secrets from Tenant DB
        const secrets = await tenantDb.select({
          id: tenantTables.userTwoFactorSecrets.id,
          userId: tenantTables.userTwoFactorSecrets.userId,
          name: tenantTables.userTwoFactorSecrets.name,
          encryptedSecret: tenantTables.userTwoFactorSecrets.encryptedSecret,
          isActive: tenantTables.userTwoFactorSecrets.isActive,
          isPrimary: tenantTables.userTwoFactorSecrets.isPrimary,
          lastUsedAt: tenantTables.userTwoFactorSecrets.lastUsedAt,
          createdAt: tenantTables.userTwoFactorSecrets.createdAt,
          updatedAt: tenantTables.userTwoFactorSecrets.updatedAt,
        })
          .from(tenantTables.userTwoFactorSecrets)
          .where(whereConditions);

        if (secrets.length === 0) {
          span.attributes["validation_result"] = "no_secrets";
          await useLogSecurityEvent(
            LoggerLevels.warn,
            "No active 2FA secrets found for user",
            "medium",
            loggerAppSections.AUTH,
            "auth.totp.no-secrets",
            { userId, secretId },
          );
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
          return { isValid: false };
        }

        span.attributes["secrets_count"] = secrets.length;

        const currentTimeInMilliseconds = getTimeNow();
        const intervalsToCheck = Math.ceil(
          this.GRACE_PERIOD_SECONDS / this.INTERVAL_SECONDS,
        );

        // Reuse TextEncoder for all comparisons in the loop
        const encoder = new TextEncoder();
        const userProvidedOTPEncoded = encoder.encode(userProvidedOTP);

        // Try to validate against each active 2FA secret
        for (const secret of secrets) {
          for (let i = -intervalsToCheck; i <= intervalsToCheck; i++) {
            const timeToCheck = currentTimeInMilliseconds +
              (i * this.INTERVAL_SECONDS * 1000);

            try {
              const expectedTOTP = await TOTPGenerationService.generateTOTP(
                secret.encryptedSecret as Uint8Array,
                timeToCheck,
              );

              if (safeEqual(userProvidedOTPEncoded, encoder.encode(expectedTOTP))) {
                // Store the used code to prevent replay
                const updatedRecentCodes = [...recentCodes, userProvidedOTP];
                if (updatedRecentCodes.length > 3) updatedRecentCodes.shift(); // Keep last 3 codes

                // Cache timestamp for consistent updates
                const currentTimestamp = Math.floor(Date.now() / 1000);

                // Run cache update and DB update in parallel
                await Promise.all([
                  cache.set(
                    CACHE_NAMESPACES.AUTH.TOTP_RECENT_CODES,
                    recentCodesKey,
                    updatedRecentCodes,
                    { ttl: 90 },
                  ),
                  tenantDb.update(tenantTables.userTwoFactorSecrets)
                    .set({
                      lastUsedAt: currentTimestamp,
                      updatedAt: currentTimestamp,
                    })
                    .where(eq(tenantTables.userTwoFactorSecrets.id, secret.id)),
                  RateLimitingService.resetRateLimit(userId),
                ]);

                span.attributes["validation_result"] = "success";
                span.attributes["matched_secret_id"] = secret.id;
                await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
                return { isValid: true, secretId: secret.id };
              }
            } catch (error) {
              // Re-throw intentional HTTP exceptions
              if (error instanceof AppHttpException) {
                await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
                throw error;
              }

              // Log unexpected errors during TOTP generation
              await useLogSecurityEvent(
                LoggerLevels.error,
                "TOTP generation failed during validation",
                "high",
                loggerAppSections.AUTH,
                "auth.totp.generation-error",
                {
                  userId,
                  secretId: secret.id,
                  error: error instanceof Error ? error.message : "Unknown error",
                },
              );
            }
          }
        }

        // Record failed attempt
        await RateLimitingService.recordAttempt(
          userId,
          {
            maxAttempts: this.RATE_LIMIT_CONFIG.MAX_ATTEMPTS,
            windowMs: this.RATE_LIMIT_CONFIG.WINDOW_SECONDS * 1000,
            blockDurationMs: this.RATE_LIMIT_CONFIG.BLOCK_DURATION_SECONDS * 1000,
            enableIPBasedAdjustment: false,
          },
        );
        span.attributes["validation_result"] = "failed";
        await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
        return { isValid: false };
      },
      {
        logOverrides: {
          message: "Unexpected error in TOTP validation",
          messageKey: "auth.totp.validate.unexpected_error",
        },
      },
    );
  }

  static async validateBackupCode(
    userId: string,
    backupCode: string,
  ): Promise<{ isValid: boolean; newBackupCodes?: string[] }> {
    return await tracedWithServiceErrorHandling(
      "AuthTOTPValidationService.validateBackupCode",
      {
        service: "AuthTOTPValidationService",
        method: "validateBackupCode",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "AUTH.ENCRYPTION_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;

        const normalizedCode = backupCode.replace(/-/g, "");
        if (normalizedCode.length !== DEFAULT_BACKUP_CODE_CONFIG.codeLength) {
          span.attributes["validation_result"] = "invalid_length";
          return { isValid: false };
        }

        // Get environment ID from global DB
        const globalDb = getGlobalDB();
        const [user] = await globalDb.select({ environmentId: globalTables.users.environmentId })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId))
          .limit(1);

        if (!user) {
          throw new Error(`User not found: ${userId}`);
        }

        const tenantDb = await getTenantDB(user.environmentId);

        // Get user's active backup codes from Tenant DB
        const backupCodesRecord = await tenantDb.select({
          userId: tenantTables.userBackupCodes.userId,
          backupCodes: tenantTables.userBackupCodes.backupCodes,
          isActive: tenantTables.userBackupCodes.isActive,
          createdAt: tenantTables.userBackupCodes.createdAt,
          updatedAt: tenantTables.userBackupCodes.updatedAt,
        })
          .from(tenantTables.userBackupCodes)
          .where(and(
            eq(tenantTables.userBackupCodes.userId, userId),
            eq(tenantTables.userBackupCodes.isActive, true),
          ))
          .limit(1);

        if (backupCodesRecord.length === 0) {
          span.attributes["validation_result"] = "no_codes";
          await useLogSecurityEvent(
            LoggerLevels.warn,
            "No active backup codes found for user",
            "medium",
            loggerAppSections.AUTH,
            "auth.backup-code.no-codes",
            { userId },
          );
          return { isValid: false };
        }

        const encryptedBackupCodes = backupCodesRecord[0]!.backupCodes as Uint8Array;
        if (!encryptedBackupCodes) {
          return { isValid: false };
        }

        const isValid = await BackupCodeGenerationService.verifyBackupCodeAgainstHash(
          backupCode,
          encryptedBackupCodes,
        );

        if (!isValid) {
          span.attributes["validation_result"] = "invalid_code";
          await RateLimitingService.recordAttempt(
            userId,
            {
              maxAttempts: this.RATE_LIMIT_CONFIG.MAX_ATTEMPTS,
              windowMs: this.RATE_LIMIT_CONFIG.WINDOW_SECONDS * 1000,
              blockDurationMs: this.RATE_LIMIT_CONFIG.BLOCK_DURATION_SECONDS * 1000,
              enableIPBasedAdjustment: false,
            },
          );
          await useLogSecurityEvent(
            LoggerLevels.warn,
            "Invalid backup code attempted",
            "medium",
            loggerAppSections.AUTH,
            "auth.backup-code.invalid",
            { userId },
          );
          return { isValid: false };
        }

        // Find and remove the matching code
        const { remainingBinaryBlob } = await BackupCodeGenerationService
          .findAndRemoveBackupCode(
            backupCode,
            encryptedBackupCodes,
          );

        // Update the database with remaining backup codes
        const updatedEncryptedCodes = remainingBinaryBlob
          ? await BackupCodeGenerationService.serializeBackUpCodesForStorage(remainingBinaryBlob)
          : null;

        // Run DB update and rate limit reset in parallel
        await Promise.all([
          tenantDb.update(tenantTables.userBackupCodes)
            .set({
              backupCodes: updatedEncryptedCodes,
              updatedAt: getTimeNowForStorage(),
            })
            .where(eq(tenantTables.userBackupCodes.userId, userId)),
          RateLimitingService.resetRateLimit(userId),
        ]);

        span.attributes["validation_result"] = "success";
        span.attributes["remaining_codes"] = remainingBinaryBlob ? Math.floor((remainingBinaryBlob.length - 16) / 32) : 0;
        return { isValid: true };
      },
      {
        logOverrides: {
          message: "Unexpected error in backup code validation",
          messageKey: "auth.backup_code.validate.unexpected_error",
        },
      },
    );
  }
}

export class AuthTOTPGenerationService {
  static async encryptSecret(secret: Uint8Array): Promise<Uint8Array> {
    return await TOTPGenerationService.encryptSecret(secret);
  }

  static async decryptSecret(encryptedSecret: Uint8Array): Promise<Uint8Array> {
    return await TOTPGenerationService.decryptSecret(encryptedSecret);
  }

  static async generateTOTP(
    encryptedKey: Uint8Array,
    timestamp: number = getTimeNow(),
  ): Promise<string> {
    return await TOTPGenerationService.generateTOTP(encryptedKey, timestamp);
  }

  static generateTOTPBackupCodes() {
    return BackupCodeGenerationService.generateTOTPBackupCodes();
  }

  static async serializeBackUpCodesForStorage(
    binaryBlob: IBackupCodeBinaryBlob,
  ): Promise<Uint8Array> {
    return await BackupCodeGenerationService.serializeBackUpCodesForStorage(
      binaryBlob,
    );
  }
}
