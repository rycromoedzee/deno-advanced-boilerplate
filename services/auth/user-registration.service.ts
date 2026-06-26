/**
 * @file services/auth/user-registration.service.ts
 * @description User Registration service (auth)
 */
import { eq, type HonoContext, type RegistrationResponseJSON } from "@deps";
import { AuthPasswordService } from "./password-auth.service.ts";
import { AuthPasskeyRegistrationService } from "./passkey-auth.service.ts";
import { getSessionCreateService } from "@services/session/index.ts";
import { EncryptionSystemUserService, PasskeyPRFService } from "@services/encryption/index.ts";
import { getUserAsymmetricKeysService, getUserLookupService } from "@services/user/index.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { canonicalizeUsername, isReservedUsername } from "@utils/auth/index.ts";
import type {
  IAuthPasswordResetTokenData,
  IAuthRegisterPasskeyBeginResponse,
  IAuthRegisterValidationResponse,
  IAuthWebAuthnCredential,
} from "@interfaces/auth.ts";
import type { ITokensDeviceTypeOptions } from "@services/token/config.ts";
import type { Span } from "@interfaces/tracing.ts";
import { getPasswordResetService, getUserMasterKeySetupService } from "./singletons.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";

/**
 * Internal response type that includes token data for cookie setting
 */
interface IRegistrationSessionResult {
  isAuthCompleted: true;
  message: string;
  userId: string;
  environmentId: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  hasMasterKey?: boolean; // Whether master key was set up (true for password, depends on PRF for passkey)
}

/**
 * UserRegistrationService
 * ------------------------------------------------
 * Orchestrates user registration flows via password reset tokens.
 * Handles both password-based and passkey-based registration.
 */
export class UserRegistrationService {
  private passwordResetService = getPasswordResetService();
  private userLookupService = getUserLookupService();
  private masterKeySetupService = getUserMasterKeySetupService();

  /**
   * Validates a registration token and returns user info.
   * Does NOT consume the token - just validates it.
   *
   * @param token - The JWT token to validate
   * @returns User info for display on registration page
   */
  async validateRegistrationToken(
    token: string,
  ): Promise<IAuthRegisterValidationResponse> {
    return await tracedWithServiceErrorHandling(
      "UserRegistrationService.validateRegistrationToken",
      {
        service: "UserRegistrationService",
        method: "validateRegistrationToken",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const tokenData = await this.validateToken(token);
        const userId = tokenData.userId;

        span.attributes["user_id"] = userId;

        // Performance: Run user lookup and passkey check in parallel
        const [user, hasPasskey] = await Promise.all([
          this.userLookupService.findUserById(userId),
          this.getUsernameAndPasskeyStatus(tokenData.userId),
        ]);

        if (!user) {
          throwHttpError("USER.NOT_FOUND");
        }

        // Get username from the parallel result
        const username = hasPasskey.username;

        span.attributes["success"] = true;
        span.attributes["environment_name"] = user.environmentName;
        span.attributes["has_username"] = !!username;
        span.attributes["has_passkey"] = hasPasskey.hasPasskey;

        return {
          fullName: `${user.firstName} ${user.lastName}`.trim(),
          environmentName: user.environmentName,
          username,
          hasPasskey: hasPasskey.hasPasskey,
        };
      },
    );
  }

  /**
   * Handles registration with password mode.
   * Validates token (single-use), sets password, creates session.
   *
   * @param token - The JWT token
   * @param password - The new password to set
   * @param deviceInfo - Device information for session
   * @param ipAddress - Client IP address
   * @param honoContext - Hono context for logging
   * @returns Session info with tokens
   */
  async registerWithPassword(
    token: string,
    password: string,
    deviceInfo: ITokensDeviceTypeOptions,
    ipAddress: string,
    honoContext: HonoContext,
  ): Promise<IRegistrationSessionResult> {
    return await tracedWithServiceErrorHandling(
      "UserRegistrationService.registerWithPassword",
      {
        service: "UserRegistrationService",
        method: "registerWithPassword",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const tokenData = await this.validateAndConsumeToken(token);

        const userId = tokenData.userId;

        span.attributes["user_id"] = userId;
        span.attributes["mode"] = "password";

        // Get user with environment info
        const user = await this.userLookupService.findUserById(userId);
        if (!user) {
          throwHttpError("USER.NOT_FOUND");
        }

        // Performance: Run password hashing and key derivation in parallel
        const [hashedPassword, derivedPasswordKeyBuffer] = await Promise.all([
          AuthPasswordService.generatePassword(password),
          EncryptionSystemUserService.generatePasswordDerivedKey(password, userId)
            .catch((error) => {
              useLogger(LoggerLevels.warn, {
                messageKey: "registration.password-key-derivation-failed",
                message: "Password key derivation failed during registration, using empty key",
                section: loggerAppSections.AUTH,
                details: {
                  userId,
                  error: error instanceof Error ? error.message : "Unknown error",
                },
              });
              return null;
            }),
        ]);

        // Store password and history in parallel
        await Promise.all([
          this.updateUserPassword(userId, hashedPassword),
          AuthPasswordService.storePasswordHistory(userId, hashedPassword),
        ]);

        // Setup master key proactively
        await this.masterKeySetupService.setupForPasswordRegistration(userId, password);

        const derivedPasswordKey = derivedPasswordKeyBuffer ? TextTransformations.fromBufferToBase64(derivedPasswordKeyBuffer) : "";

        // Create session
        const sessionService = getSessionCreateService();
        const sessionResult = await sessionService.createUserSession(
          userId,
          deviceInfo,
          ipAddress,
          honoContext,
          false,
          derivedPasswordKey,
        );

        await getUserAsymmetricKeysService().ensureKeyPairFromSession(
          userId,
          sessionResult.accessToken,
          undefined,
          undefined,
          sessionResult.sessionKey,
          user.environmentId,
        );

        // Invalidate all remaining reset tokens for this user
        await this.passwordResetService.invalidateAllUserPasswordResetTokens(
          userId,
        );

        span.attributes["success"] = true;

        return {
          isAuthCompleted: true,
          message: "Registration successful",
          userId: user.id,
          environmentId: user.environmentId,
          displayName: `${user.firstName} ${user.lastName}`.trim(),
          accessToken: sessionResult.accessToken,
          refreshToken: sessionResult.refreshToken,
          expiresAt: sessionResult.expiresAt,
          refreshExpiresAt: sessionResult.refreshExpiresAt,
        };
      },
    );
  }

  /**
   * Initiates passkey registration flow.
   * Validates token (NOT consumed yet), returns registration options with PRF extension enabled.
   *
   * @param token - The JWT token
   * @param hostname - The relying party hostname
   * @returns Passkey registration options for WebAuthn with PRF extension
   */
  async beginPasskeyRegistration(
    token: string,
    hostname: string,
    options?: { username?: string; displayName?: string },
  ): Promise<IAuthRegisterPasskeyBeginResponse> {
    return await tracedWithServiceErrorHandling(
      "UserRegistrationService.beginPasskeyRegistration",
      {
        service: "UserRegistrationService",
        method: "beginPasskeyRegistration",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        // Validate but do NOT consume token - it's needed for the verify step
        const tokenData = await this.validateToken(token);
        const userId = tokenData.userId;

        span.attributes["user_id"] = userId;
        span.attributes["mode"] = "passkey-begin";
        span.attributes["hostname"] = hostname;

        const user = await this.userLookupService.findUserById(userId);
        if (!user) {
          throwHttpError("USER.NOT_FOUND");
        }

        const hasPasskey = await this.checkUserHasPasskey(userId);
        if (hasPasskey) {
          throwHttpError("PASSKEY.ALREADY_EXISTS");
        }

        const providedUsername = options?.username ? canonicalizeUsername(options.username) : undefined;
        const providedDisplayName = this.sanitizeDisplayName(
          options?.displayName ?? null,
        );

        const userName = providedUsername ||
          `${user.firstName} ${user.lastName}`.trim() ||
          user.id;
        const registrationDisplayName = providedDisplayName ||
          `${user.firstName} ${user.lastName}`.trim() ||
          userName;

        // Generate passkey registration options with PRF extension enabled
        const { attemptId, creationOptions, prfSalt: _prfSalt } = await AuthPasskeyRegistrationService.buildRegistrationConfigWithPRF({
          urlHostName: hostname,
          userName,
          displayName: registrationDisplayName,
        });

        span.attributes["success"] = true;
        span.attributes["attempt_id"] = attemptId.substring(0, 8) + "...";
        span.attributes["prf_enabled"] = true;

        return {
          isAuthCompleted: false,
          nextStep: "passkey-register",
          attemptId,
          creationOptions: creationOptions as unknown as Record<string, unknown>,
        };
      },
    );
  }

  /**
   * Verifies passkey registration and completes the flow.
   * Validates token (single-use), stores credential, creates session.
   * If PRF output is provided, caches the PRF-derived key for encryption.
   * If username is provided, validates and sets it for the user.
   *
   * @param token - The JWT token
   * @param attemptId - The attempt ID from passkey-begin step
   * @param credential - The WebAuthn registration response
   * @param url - The full URL for origin verification
   * @param hostname - The relying party hostname
   * @param deviceInfo - Device information for session
   * @param ipAddress - Client IP address
   * @param honoContext - Hono context for logging
   * @param prfOutput - Optional PRF output from authenticator for encryption key derivation
   * @param username - Optional username to set for the user
   * @returns Session info with tokens
   */
  async verifyPasskeyRegistration(
    token: string,
    attemptId: string,
    credential: RegistrationResponseJSON,
    url: string,
    hostname: string,
    deviceInfo: ITokensDeviceTypeOptions,
    ipAddress: string,
    honoContext: HonoContext,
    prfOutput?: { first?: string },
    username?: string,
    displayName?: string | null,
  ): Promise<IRegistrationSessionResult> {
    return await tracedWithServiceErrorHandling(
      "UserRegistrationService.verifyPasskeyRegistration",
      {
        service: "UserRegistrationService",
        method: "verifyPasskeyRegistration",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const tokenData = await this.validateAndConsumeToken(token);
        const userId = tokenData.userId;

        span.attributes["user_id"] = userId;
        span.attributes["mode"] = "passkey-verify";
        span.attributes["attempt_id"] = attemptId.substring(0, 8) + "...";
        span.attributes["has_prf_output"] = !!(prfOutput?.first);
        span.attributes["has_username"] = !!username;

        const user = await this.userLookupService.findUserById(userId);
        if (!user) {
          throwHttpError("USER.NOT_FOUND");
        }

        // Verify passkey registration
        const { credential: verifiedCredential } = await AuthPasskeyRegistrationService.register({
          passkeyRegistrationBody: credential,
          attemptId,
          urlHostName: hostname,
          url,
        });

        // Performance: Check passkey existence and store credential can be done together
        // But we need to check first before storing
        const hasPasskey = await this.checkUserHasPasskey(userId);
        if (hasPasskey) {
          throwHttpError("PASSKEY.ALREADY_EXISTS");
        }

        // Store the passkey credential
        await this.storePasskeyCredential(
          userId,
          verifiedCredential,
          this.sanitizeDisplayName(displayName ?? null),
        );

        // Log PRF state before master key setup
        useLogger(LoggerLevels.debug, {
          message: "verifyPasskeyRegistration - PRF state check",
          messageKey: "registration.prf_state_check",
          section: loggerAppSections.AUTH,
          details: {
            userId,
            credentialId: verifiedCredential.id,
            hasPrfOutput: !!prfOutput,
            prfOutputFirst: prfOutput?.first ? `${prfOutput.first.substring(0, 20)}... (${prfOutput.first.length} chars)` : null,
            prfOutputKeys: prfOutput ? Object.keys(prfOutput) : [],
          },
        });

        // Setup master key proactively with PRF
        if (prfOutput?.first) {
          useLogger(LoggerLevels.info, {
            message: "Setting up master key with PRF",
            messageKey: "registration.prf_master_key_setup_start",
            section: loggerAppSections.AUTH,
            details: {
              userId,
              credentialId: verifiedCredential.id,
            },
          });

          await this.masterKeySetupService.setupForPasskeyRegistration(
            userId,
            verifiedCredential.id,
            prfOutput.first,
          );
        } else {
          // Log when PRF is NOT set up - this is expected during registration
          useLogger(LoggerLevels.debug, {
            message: "No PRF output provided - master key NOT set up for passkey registration",
            messageKey: "registration.prf_not_provided",
            section: loggerAppSections.AUTH,
            details: {
              userId,
              credentialId: verifiedCredential.id,
              note: "PRF output is only available during authentication, not registration. This is expected behavior per WebAuthn spec.",
            },
          });
        }

        // If username is provided, validate and set it
        if (username) {
          await this.validateAndSetUsername(userId, username);
          span.attributes["username_set"] = true;
        }

        // Create session (no password-derived key for passkey auth)
        const sessionService = getSessionCreateService();
        const sessionResult = await sessionService.createUserSession(
          userId,
          deviceInfo,
          ipAddress,
          honoContext,
          false,
          "", // Empty derived key for passkey auth
        );

        // If PRF output is provided, derive key and cache it in session
        if (prfOutput?.first) {
          try {
            const prfDerivedKey = await PasskeyPRFService.deriveKeyFromPRF(
              prfOutput.first,
              userId,
            );

            // Cache the PRF-derived key in the session
            await PasskeyPRFService.cachePRFDerivedKey(
              sessionResult.accessToken,
              sessionResult.expiresAt - Math.floor(Date.now() / 1000),
              TextTransformations.fromBufferToBase64(prfDerivedKey),
              verifiedCredential.id,
            );

            span.attributes["prf_key_cached"] = true;

            useLogger(LoggerLevels.info, {
              message: "PRF-derived key cached for passkey registration",
              messageKey: "registration.prf_key_cached",
              section: loggerAppSections.AUTH,
              details: { userId },
            });
          } catch (error) {
            // Log but don't fail - PRF is optional
            useLogger(LoggerLevels.warn, {
              message: "Failed to cache PRF-derived key during registration",
              messageKey: "registration.prf_key_cache_failed",
              section: loggerAppSections.AUTH,
              details: {
                userId,
                error: error instanceof Error ? error.message : "Unknown error",
              },
            });
            span.attributes["prf_key_cached"] = false;
          }
        }

        // Invalidate all remaining reset tokens for this user
        await this.passwordResetService.invalidateAllUserPasswordResetTokens(
          userId,
        );

        span.attributes["success"] = true;

        // Master key was set up only if PRF output was provided
        const hasMasterKey = !!prfOutput?.first;

        return {
          isAuthCompleted: true,
          message: "Passkey registration successful",
          userId: user.id,
          environmentId: user.environmentId,
          displayName: `${user.firstName} ${user.lastName}`.trim(),
          accessToken: sessionResult.accessToken,
          refreshToken: sessionResult.refreshToken,
          expiresAt: sessionResult.expiresAt,
          refreshExpiresAt: sessionResult.refreshExpiresAt,
          hasMasterKey, // Will be false since PRF is not available during registration
        };
      },
    );
  }

  // --------------------
  // Private Helper Methods
  // --------------------

  /**
   * Validates token without consuming it
   */
  private async validateToken(
    token: string,
  ): Promise<IAuthPasswordResetTokenData> {
    const tokenData = await this.passwordResetService.validatePasswordResetToken(
      token,
    );
    if (!tokenData) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }
    return tokenData;
  }

  /**
   * Validates and marks token as used (single-use enforcement)
   */
  private async validateAndConsumeToken(
    token: string,
  ): Promise<IAuthPasswordResetTokenData> {
    const tokenData = await this.validateToken(token);
    await this.passwordResetService.markTokenAsUsed(tokenData.tokenHash);
    return tokenData;
  }

  /**
   * Updates the password hash in users table
   */
  private async updateUserPassword(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    const db = getGlobalDB();
    await db
      .update(globalTables.users)
      .set({ password: passwordHash })
      .where(eq(globalTables.users.id, userId));
  }

  /**
   * Stores passkey credential in database
   */
  private async storePasskeyCredential(
    userId: string,
    credential: IAuthWebAuthnCredential,
    displayName?: string | null,
  ): Promise<void> {
    const db = getGlobalDB();

    await db.insert(globalTables.userPasskeys).values({
      userId,
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      backedUp: credential.backedUp,
      transports: credential.transports || [],
      displayName: displayName ?? null,
    });
  }

  private sanitizeDisplayName(value: string | null): string | null {
    if (!value) return null;
    const stripped = TextTransformations.stripHtml(value).trim();
    return stripped.length > 0 ? stripped : null;
  }

  /**
   * Gets username and passkey status for a user in a single query
   */
  private async getUsernameAndPasskeyStatus(
    userId: string,
  ): Promise<{ username: string | null; hasPasskey: boolean }> {
    const db = getGlobalDB();

    // Get username and check for passkeys in parallel
    const [userResult, passkeyResult] = await Promise.all([
      db
        .select({ username: globalTables.users.username })
        .from(globalTables.users)
        .where(eq(globalTables.users.id, userId))
        .limit(1),
      db
        .select({ id: globalTables.userPasskeys.userId })
        .from(globalTables.userPasskeys)
        .where(eq(globalTables.userPasskeys.userId, userId))
        .limit(1),
    ]);

    return {
      username: userResult[0]?.username ?? null,
      hasPasskey: passkeyResult.length > 0,
    };
  }

  /**
   * Checks if a user has any passkeys registered
   * @returns true if passkeys exist, false otherwise
   */
  private async checkUserHasPasskey(userId: string): Promise<boolean> {
    const db = getGlobalDB();
    const result = await db
      .select({ id: globalTables.userPasskeys.userId })
      .from(globalTables.userPasskeys)
      .where(eq(globalTables.userPasskeys.userId, userId))
      .limit(1);

    return result.length > 0;
  }

  /**
   * Validates and sets username for a user.
   * Checks if username is already taken by another user.
   * @throws HttpException if username is already taken
   */
  private async validateAndSetUsername(
    userId: string,
    username: string,
  ): Promise<void> {
    const db = getGlobalDB();
    const canonicalUsername = canonicalizeUsername(username);

    if (isReservedUsername(canonicalUsername)) {
      throwHttpError("USER.RESERVED_USERNAME");
    }

    // Check if username is already taken by another user
    const existingUser = await db
      .select({ id: globalTables.users.id })
      .from(globalTables.users)
      .where(eq(globalTables.users.username, canonicalUsername))
      .limit(1);

    if (existingUser.length > 0 && existingUser[0].id !== userId) {
      throwHttpError("USER.USERNAME_ALREADY_EXISTS");
    }

    // Set the username
    await db
      .update(globalTables.users)
      .set({ username: canonicalUsername })
      .where(eq(globalTables.users.id, userId));
  }
}
