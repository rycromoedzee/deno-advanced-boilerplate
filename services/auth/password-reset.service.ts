/**
 * @file services/auth/password-reset.service.ts
 * @description Password Reset service (auth)
 */
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { generateJwtResetToken } from "@services/token/index.ts";
import { tokenHashString } from "@services/token/token-utils.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { IAuthPasswordResetResult, IAuthPasswordResetTokenData } from "@interfaces/auth.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import type { Span } from "@interfaces/tracing.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { eq } from "@deps";
/**
 * Password Reset Service
 * ------------------------------------------------
 * Provides secure password reset token generation, validation, and expiration handling.
 * Uses JWT tokens with secure hashing similar to unsubscribe email URI generation.
 *
 * - Generates secure password reset tokens using existing JWT patterns
 * - Implements token hashing using blake3 for secure storage
 * - Provides token validation and expiration handling
 * - Integrates with existing cache infrastructure for token storage
 */

export class PasswordResetService {
  /**
   * Generates a secure password reset token with hashing and cache storage.
   * Ensures only ONE active reset token per user at a time.
   * @param userId - User ID for the reset token.
   * @returns Promise<IPasswordResetResult> The token, hashed token, and expiration.
   * @throws AppHttpException on generation errors.
   */
  async generatePasswordResetToken(
    userId: string,
  ): Promise<IAuthPasswordResetResult> {
    return await tracedWithServiceErrorHandling(
      "PasswordResetService.generatePasswordResetToken",
      {
        service: "PasswordResetService",
        method: "generatePasswordResetToken",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (_span: Span) => {
        // Invalidate any existing tokens first (ensures only 1 token per user)
        await this.invalidateAllUserPasswordResetTokens(userId);

        // Generate JWT token using existing pattern
        const token = generateJwtResetToken();

        // Hash the token to look up in cache
        const hashedToken = tokenHashString(token);

        const now = getTimeNow();
        const expiresAt = now + (JWT_TOKEN_CONFIG.tokenTTL.reset * 1000);

        const environmentId = await getGlobalDB()
          .select({ environmentId: globalTables.users.environmentId })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId))
          .limit(1);

        // Store token data in cache with expiration
        const tokenData: IAuthPasswordResetTokenData = {
          userId,
          tokenHash: hashedToken,
          createdAt: now,
          expiresAt,
          used: false,
          environmentId: environmentId[0].environmentId,
        };

        const cache = await getCache();

        // Store token
        await cache.set(
          CACHE_NAMESPACES.AUTH.PASSWORD_RESET,
          hashedToken,
          tokenData,
          { ttl: JWT_TOKEN_CONFIG.tokenTTL.reset },
        );

        // Store reference to user's token for fast invalidation (single token)
        const userTokensKey = `user_tokens:${userId}`;
        await cache.set(
          CACHE_NAMESPACES.AUTH.PASSWORD_RESET,
          userTokensKey,
          [hashedToken],
          { ttl: JWT_TOKEN_CONFIG.tokenTTL.reset },
        );

        return {
          token,
          hashedToken,
          expiresAt,
        };
      },
      {
        logOverrides: {
          message: "Unexpected error generating password reset token",
          messageKey: "password_reset.generate_token.unexpected_error",
        },
      },
    );
  }

  /**
   * Validates a password reset token and returns user data if valid.
   * @param token - The JWT token to validate.
   * @returns Promise<IPasswordResetTokenData | null> Token data if valid, null otherwise.
   */
  async validatePasswordResetToken(
    token: string,
  ): Promise<IAuthPasswordResetTokenData | null> {
    try {
      // Hash the token to look up in cache
      const hashedToken = tokenHashString(token);

      // Retrieve token data from cache
      const tokenData = await (await getCache()).get<
        IAuthPasswordResetTokenData
      >(
        CACHE_NAMESPACES.AUTH.PASSWORD_RESET,
        hashedToken,
      );

      if (!tokenData) {
        return null;
      }

      // Check if token is expired
      const now = getTimeNow();
      if (tokenData.expiresAt < now) {
        // Clean up expired token
        await this.invalidateAllUserPasswordResetTokens(tokenData.userId);
        return null;
      }

      // Check if token has been used
      if (tokenData.used) {
        return null;
      }

      return tokenData;
    } catch (error) {
      // Log unexpected errors for debugging/security monitoring
      useLogger(LoggerLevels.warn, {
        message: "Password reset token validation failed unexpectedly",
        messageKey: "password_reset.validate_token.unexpected_error",
        section: loggerAppSections.AUTH,
        raw: error instanceof Error ? { message: error.message } : { error: "Unknown error" },
      });
      return null;
    }
  }

  /**
   * Marks a password reset token as used to prevent reuse.
   * @param hashedToken - The hashed token to mark as used.
   * @returns Promise<boolean> True if successfully marked as used.
   */
  async markTokenAsUsed(hashedToken: string): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "PasswordResetService.markTokenAsUsed",
      {
        service: "PasswordResetService",
        method: "markTokenAsUsed",
        section: loggerAppSections.AUTH,
        details: { hashedToken },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (_span: Span) => {
        const tokenData = await (await getCache()).get<
          IAuthPasswordResetTokenData
        >(
          CACHE_NAMESPACES.AUTH.PASSWORD_RESET,
          hashedToken,
        );

        if (!tokenData) {
          return false;
        }

        // Update token data to mark as used
        const updatedTokenData: IAuthPasswordResetTokenData = {
          ...tokenData,
          used: true,
        };

        await (await getCache()).set(
          CACHE_NAMESPACES.AUTH.PASSWORD_RESET,
          hashedToken,
          updatedTokenData,
          { ttl: JWT_TOKEN_CONFIG.tokenTTL.reset },
        );

        return true;
      },
      {
        logOverrides: {
          message: "Unexpected error marking password reset token as used",
          messageKey: "password_reset.mark_token_used.unexpected_error",
        },
      },
    ).catch(() => false); // Convert errors to false return for backward compatibility
  }

  /**
   * Invalidates all password reset tokens for a specific user.
   * This is useful when a user successfully resets their password.
   *
   * Optimized implementation using a secondary index for O(1) user token lookups.
   *
   * @param userId - The user ID to invalidate tokens for.
   * @returns Promise<number> Number of tokens invalidated.
   */
  async invalidateAllUserPasswordResetTokens(userId: string): Promise<number> {
    return await tracedWithServiceErrorHandling(
      "PasswordResetService.invalidateAllUserPasswordResetTokens",
      {
        service: "PasswordResetService",
        method: "invalidateAllUserPasswordResetTokens",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (_span: Span) => {
        const userTokensKey = `user_tokens:${userId}`;
        const cache = await getCache();

        // Get all tokens for this user in O(1) time
        const userTokens = await cache.get<string[]>(
          CACHE_NAMESPACES.AUTH.PASSWORD_RESET,
          userTokensKey,
        ) || [];

        let invalidatedCount = 0;

        // Delete each token
        for (const hashedToken of userTokens) {
          await cache.delete(
            CACHE_NAMESPACES.AUTH.PASSWORD_RESET,
            hashedToken,
          );
          invalidatedCount++;
        }

        // Clear the user token index
        await cache.delete(
          CACHE_NAMESPACES.AUTH.PASSWORD_RESET,
          userTokensKey,
        );

        return invalidatedCount;
      },
      {
        logOverrides: {
          message: "Unexpected error invalidating all user password reset tokens",
          messageKey: "password_reset.invalidate_all_tokens.unexpected_error",
        },
      },
    );
  }
}
