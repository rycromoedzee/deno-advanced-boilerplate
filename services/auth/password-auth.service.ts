/**
 * @file services/auth/password-auth.service.ts
 * @description Password Auth service (auth)
 */
import { argon2Hash, Argon2Variant, argon2Verify, Argon2Version, desc, eq, inArray } from "@deps";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/index.ts";
import { envConfig } from "@config/env.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { SCHEMA_VALIDATION_PASSWORD } from "@models/auth/index.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { CommonPasswordFilter, PASSWORD_HASHING_CONFIG } from "@utils/text/index.ts";
import type { IAuthDelayResult, IAuthPepperConfig } from "@interfaces/auth.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import type { Span } from "@interfaces/tracing.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";

export class AuthPasswordService {
  /**
   * Generates a hashed password using Argon2id with pepper
   * @param password - The plain text password to hash
   * @returns Promise A PHC-formatted string: $argon2id$v=19$m=...,t=...,p=1$<salt>$<hash>
   * @throws {Error} If password hashing fails or password doesn't meet strength requirements
   */
  static async generatePassword(password: string, isAllowCommon: boolean = false) {
    if (typeof password !== "string") {
      throwHttpError("VALIDATION.INVALID_FORMAT");
    }

    password = password.trim();

    await this.validatePasswordStrength(password, isAllowCommon);

    return await tracedWithServiceErrorHandling(
      "AuthPasswordService.generatePassword",
      {
        service: "AuthPasswordService",
        method: "generatePassword",
        section: loggerAppSections.PASSWORD,
      },
      "AUTH.ENCRYPTION_FAILED",
      async (_span: Span) => {
        const pepper = envConfig.auth.passwordPepper;
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const secret = pepper ? new TextEncoder().encode(pepper) : undefined;

        // Returns PHC string: $argon2id$v=19$m=98304,t=3,p=1$<salt>$<hash>
        return await argon2Hash(password, {
          salt,
          secret,
          variant: Argon2Variant.Argon2id,
          version: Argon2Version.V13,
          memoryCost: PASSWORD_HASHING_CONFIG.STORAGE.memoryCost,
          timeCost: PASSWORD_HASHING_CONFIG.STORAGE.timeCost,
          lanes: PASSWORD_HASHING_CONFIG.STORAGE.parallelism,
          hashLength: PASSWORD_HASHING_CONFIG.STORAGE.hashLength,
        });
      },
      {
        logOverrides: {
          message: "Password => Error hashing password",
          messageKey: "password.error.hashing",
        },
      },
    );
  }

  /**
   * Verifies a password against its hash and checks if rehashing is needed
   * @param {string} hashedPassword - The PHC-formatted hashed password to verify against
   * @param {string} password - The plain text password to verify
   * @param {boolean} [useProgressiveDelay=false] - Whether to use progressive delay protection
   * @param {string} [userId] - Optional user ID for tracking attempts
   * @param {string} [ipAddress] - IP address of the authentication attempt
   * @param {string} [userAgent] - User agent string of the authentication attempt
   * @returns {Promise<{valid: boolean, needsRehash: boolean, delayResult?: IAuthDelayResult}>} Object containing validation result and delay information
   * @throws {Error} If password validation fails
   */
  static async validatePassword(
    hashedPassword: string,
    password: string,
    userId?: string,
    _ipAddress?: string,
    _userAgent?: string,
  ): Promise<
    { valid: boolean; needsRehash: boolean; delayResult?: IAuthDelayResult }
  > {
    const startTime = performance.now();

    return await tracedWithServiceErrorHandling(
      "AuthPasswordService.validatePassword",
      {
        service: "AuthPasswordService",
        method: "validatePassword",
        section: loggerAppSections.PASSWORD,
      },
      "AUTH.ENCRYPTION_FAILED",
      async (span: Span) => {
        span.attributes["has_user_id"] = !!userId;

        const pepper = envConfig.auth.passwordPepper;
        const secret = pepper ? new TextEncoder().encode(pepper) : undefined;

        const valid = await argon2Verify(hashedPassword, password, secret);

        span.attributes["valid"] = valid;
        span.attributes["needs_rehash"] = false;

        return { valid, needsRehash: false };
      },
      {
        attributes: {
          has_user_id: !!userId,
        },
        logOverrides: {
          message: "Password => Error validating password",
          messageKey: "password.error.verification",
        },
        onUnexpected: async () => {
          // Ensure timing protection even on unexpected errors
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.PASSWORD);
        },
      },
    );
  }

  static async validatePasswordStrength(password: string, isAllowCommon: boolean = false) {
    const isValid = SCHEMA_VALIDATION_PASSWORD.safeParse(password);
    if (!isValid.success) {
      throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
    }

    // Probabilistic membership test against the common-password blocklist.
    // Uses a Bloom filter (~240KB) instead of an in-memory Set (~6-12MB).
    if (!isAllowCommon && await CommonPasswordFilter.isCommon(password)) {
      throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
    }
  }

  private static getPepperByVersion(version: number): string {
    const config = envConfig.auth as unknown as IAuthPepperConfig;

    // If rotation is not in progress, always use current pepper
    if (!config.isPasswordRotationInProgress) {
      return config.passwordPepper;
    }

    switch (version) {
      case 1:
        return config.passwordPepper;
      case 2:
        return config.newPasswordPepper || config.passwordPepper;
      default:
        return config.passwordPepper;
    }
  }

  private static getCurrentPepperVersion(): number {
    const config = envConfig.auth as unknown as IAuthPepperConfig;
    return (config.isPasswordRotationInProgress && config.newPasswordPepper) ? 2 : 1;
  }

  /**
   * Checks if a password has been used recently.
   * @returns `true` if the password IS found in recent history (previously used — reject it),
   *          `false` if the password is not in history (safe to use).
   */
  static async checkPasswordHistory(
    password: string,
    userId: string,
    historyCount: number = 5,
  ): Promise<boolean> {
    try {
      // Get recent password history
      const db = getGlobalDB();
      const passwordHistory = await db
        .select()
        .from(globalTables.userPasswordHistory)
        .where(eq(globalTables.userPasswordHistory.userId, userId))
        .orderBy(desc(globalTables.userPasswordHistory.createdAt))
        .limit(historyCount);

      // Check all historical passwords in parallel
      const results = await Promise.all(
        passwordHistory.map((entry) => this.validatePassword(entry.passwordHash, password)),
      );

      return results.some((r) => r.valid);
    } catch (error) {
      // Re-throw intentional HTTP exceptions
      if (error instanceof AppHttpException) {
        throw error;
      }

      // Log unexpected errors
      useLogger(LoggerLevels.error, {
        messageKey: "password.history.check.error",
        message: "Failed to check password history",
        raw: error,
        section: loggerAppSections.PASSWORD,
      });

      // On error, allow password change but log the issue
      return false;
    }
  }

  static async storePasswordHistory(
    userId: string,
    passwordHash: string,
    historyCount: number = 5,
  ): Promise<void> {
    try {
      // Store new password in history
      const db = getGlobalDB();
      await databaseCreateWithRetry(async (newId) => {
        await db.insert(globalTables.userPasswordHistory).values({
          id: newId,
          userId,
          passwordHash,
        });
        return newId;
      }, generateIdRandom);

      // Clean up old history entries beyond the configured limit
      const allHistory = await db
        .select()
        .from(globalTables.userPasswordHistory)
        .where(eq(globalTables.userPasswordHistory.userId, userId))
        .orderBy(desc(globalTables.userPasswordHistory.createdAt));

      if (allHistory.length > historyCount) {
        const entriesToDelete = allHistory.slice(historyCount);
        const idsToDelete = entriesToDelete.map((entry) => entry.id);

        // Batch delete using inArray for better performance
        await db
          .delete(globalTables.userPasswordHistory)
          .where(inArray(globalTables.userPasswordHistory.id, idsToDelete));
      }
    } catch (error) {
      // Re-throw intentional HTTP exceptions
      if (error instanceof AppHttpException) {
        throw error;
      }

      // Log unexpected errors
      useLogger(LoggerLevels.error, {
        messageKey: "password.history.store.error",
        message: "Failed to store password history",
        raw: error,
        section: loggerAppSections.PASSWORD,
      });

      // Don't throw error as this shouldn't block password changes
    }
  }
}
