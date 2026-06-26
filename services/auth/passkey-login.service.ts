/**
 * @file services/auth/passkey-login.service.ts
 * @description Passkey Login service (auth)
 */
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  eq,
  type HonoContext,
  inArray,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@deps";
import { UserLookupService } from "@services/user/lookup.service.ts";
import { AuthPasskeyAuthenticationService } from "./passkey-auth.service.ts";
import { getSessionCreateService, getSessionRevocationService } from "@services/session/index.ts";
import {
  EncryptionSystemUserService,
  PasskeyPRFService,
  PerCredentialPRFService,
  RotationEscrowService,
} from "@services/encryption/index.ts";
import { UserEnhancedEncryptionSettingsService } from "@services/user/enhanced-encryption.service.ts";
import { getUserAsymmetricKeysService } from "@services/user/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import type { ITokensDeviceTypeOptions } from "@services/token/config.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { AuthServiceCacheKeys } from "@utils/auth/index.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";

/**
 * Internal response type that includes token data for cookie setting
 */
interface IPasskeyLoginResult {
  isAuthCompleted: true;
  message: string;
  userId: string;
  environmentId: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  /** Ephemeral session key to set as a cookie for client-bound cache encryption */
  sessionKey: string;
  /** Set if passkey has stale encryption wrap and escrow expired - client must call rewrap endpoint */
  stalePasskeyCredentialId?: string;
}

/**
 * Response for passkey login begin
 */
interface IPasskeyLoginBeginResponse {
  isAuthCompleted: false;
  nextStep: "passkey-verify";
  attemptId: string;
  requestOptions: PublicKeyCredentialRequestOptionsJSON;
  prfEvaluationRequest?: {
    salt?: string;
    saltsByCredential?: Record<string, string>;
  };
}

/**
 * Stored credential from database
 */
interface IStoredPasskeyCredential {
  id: string;
  publicKey: string;
  counter: number;
  backedUp: boolean;
  transports: AuthenticatorTransportFuture[] | null;
}

/**
 * PasskeyLoginService
 * ------------------------------------------------
 * Orchestrates passkey-based authentication for login.
 * Handles email lookup, credential retrieval, and session creation.
 */
export class PasskeyLoginService {
  private userLookupService = new UserLookupService();
  private enhancedEncryptionSettingsService = new UserEnhancedEncryptionSettingsService();

  /**
   * Initiates passkey login by looking up credentials and building options.
   *
   * @param username - The user's username
   * @param hostname - The relying party hostname
   * @returns Passkey login options for WebAuthn
   */
  async beginPasskeyLogin(
    username: string,
    hostname: string,
  ): Promise<IPasskeyLoginBeginResponse> {
    return await tracedWithServiceErrorHandling(
      "PasskeyLoginService.beginPasskeyLogin",
      {
        service: "PasskeyLoginService",
        method: "beginPasskeyLogin",
        section: loggerAppSections.PASSKEYS,
        details: { hostname },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["mode"] = "passkey-login-begin";
        span.attributes["hostname"] = hostname;

        // Look up user by username
        const userResult = await this.userLookupService.findUserByUsername(username);
        if (!userResult || userResult.users.length === 0) {
          // Don't reveal if user exists - return generic error
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        // Get the first user (for single-tenant login)
        const user = userResult.users[0];
        span.attributes["user_id"] = user.userId;

        // Get stored passkey credentials for this user
        const credentials = await this.getPasskeyCredentialsByUserId(
          user.userId,
        );

        if (credentials.length === 0) {
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        // Build login options with PRF
        const prfSaltsByCredential = await this.getPRFSaltsForCredentials(
          credentials.map((cred) => cred.id),
          user.userId,
          true,
        );

        const prfCredentials = credentials.filter((cred) => !!prfSaltsByCredential[cred.id]);
        if (prfCredentials.length === 0) {
          throwHttpError("ENCRYPTION.PRF_SETUP_REQUIRED");
        }

        const loginConfigResult = await AuthPasskeyAuthenticationService.buildLoginConfigWithPRF({
          hostname,
          storedCredentials: prfCredentials.map((cred) => ({
            id: cred.id,
            transports: cred.transports ?? undefined,
          })),
          prfSaltsByCredential,
        });

        const attemptId = loginConfigResult.attemptId;

        const prfEvaluationRequest = loginConfigResult.prfEvaluationRequest;

        // Store the credentials and user info for verification step
        this.storeLoginAttempt(attemptId, {
          userId: user.userId,
          credentials: prfCredentials,
        });

        span.attributes["success"] = true;
        span.attributes["attempt_id"] = attemptId.substring(0, 8) + "...";
        span.attributes["credential_count"] = prfCredentials.length;

        return {
          isAuthCompleted: false,
          nextStep: "passkey-verify",
          attemptId,
          requestOptions: loginConfigResult.requestOptions,
          prfEvaluationRequest,
        };
      },
    );
  }

  /**
   * Verifies passkey authentication and creates session.
   * Supports PRF extension for encryption key derivation.
   *
   * @param attemptId - The attempt ID from passkey-begin step
   * @param response - The WebAuthn authentication response
   * @param url - The full URL for origin verification
   * @param _hostname - The relying party hostname (unused but kept for API consistency)
   * @param deviceInfo - Device information for session
   * @param ipAddress - Client IP address
   * @param honoContext - Hono context for logging
   * @param prfOutput - Optional PRF output from the client for encryption key derivation
   * @returns Session info with tokens
   */
  async verifyPasskeyLogin(
    attemptId: string,
    response: AuthenticationResponseJSON,
    url: string,
    _hostname: string,
    deviceInfo: ITokensDeviceTypeOptions,
    ipAddress: string,
    honoContext: HonoContext,
    prfOutput?: string, // Base64-encoded PRF output from client
  ): Promise<IPasskeyLoginResult> {
    return await tracedWithServiceErrorHandling(
      "PasskeyLoginService.verifyPasskeyLogin",
      {
        service: "PasskeyLoginService",
        method: "verifyPasskeyLogin",
        section: loggerAppSections.PASSKEYS,
        details: {
          attemptId: attemptId.substring(0, 8) + "...",
          hasPrfOutput: !!prfOutput,
        },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["mode"] = "passkey-login-verify";
        span.attributes["attempt_id"] = attemptId.substring(0, 8) + "...";
        span.attributes["has_prf_output"] = !!prfOutput;

        // Retrieve stored login attempt data
        const loginAttempt = await this.getLoginAttempt(attemptId);
        if (!loginAttempt) {
          throwHttpError("AUTH.SESSION_EXPIRED");
        }

        span.attributes["user_id"] = loginAttempt.userId;

        // Find the credential that matches the response
        const credential = loginAttempt.credentials.find(
          (cred) => cred.id === response.id,
        );
        if (!credential) {
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        // Create URL object for verification
        const originUrl = new URL(url);

        // Verify passkey authentication
        const { authenticationInfo } = await AuthPasskeyAuthenticationService.login({
          credential: {
            id: credential.id,
            publicKey: credential.publicKey,
            counter: credential.counter,
            backedUp: credential.backedUp,
            transports: credential.transports ?? undefined,
          },
          response,
          attemptId,
          url: originUrl,
        });

        // Update credential counter after successful authentication
        await this.updateCredentialCounter(
          credential.id,
          authenticationInfo.newCounter,
        );

        // Get user with environment info
        const user = await this.userLookupService.findUserById(
          loginAttempt.userId,
        );
        if (!user) {
          throwHttpError("USER.NOT_FOUND");
        }

        const hasEnhancedEncryption = await this
          .enhancedEncryptionSettingsService.hasEnhancedEncryptionEnabled(
            user.id,
          );
        span.attributes["has_enhanced_encryption"] = hasEnhancedEncryption;

        let prfDerivedKeyBase64: string | undefined;
        let prfDerivedKey: Uint8Array | undefined;
        if (!prfOutput) {
          useLogger(LoggerLevels.warn, {
            message: "verifyPasskeyLogin - missing PRF output for enhanced encryption",
            messageKey: "passkey.login_verify.missing_prf_output",
            section: loggerAppSections.PASSKEYS,
            details: {
              userId: user.id,
              note: "Enhanced encryption requires PRF output, but frontend did not provide it",
            },
          });
          span.attributes["enhanced_unlock_reason"] = "missing_prf_output";
          throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
        }

        try {
          prfDerivedKey = await PasskeyPRFService.deriveKeyFromPRF(
            prfOutput,
            user.id,
          );

          await PerCredentialPRFService.decryptWithCredentialPRF(
            credential.id,
            prfOutput,
            user.id,
          );

          prfDerivedKeyBase64 = TextTransformations.fromBufferToBase64(
            prfDerivedKey,
          );
          span.attributes["prf_unlock_validated"] = true;
        } catch (error) {
          span.attributes["enhanced_unlock_reason"] = "prf_validation_failed";
          throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
        }

        // Check for stale passkey (version mismatch) and process escrow if needed
        let stalePasskeyCredentialId: string | undefined;
        const db = getGlobalDB();
        try {
          // Fetch credential's masterKeyVersion
          const credentialVersionRow = await db
            .select({ masterKeyVersion: globalTables.passkeyPRFKeys.masterKeyVersion })
            .from(globalTables.passkeyPRFKeys)
            .where(eq(globalTables.passkeyPRFKeys.credentialId, credential.id))
            .limit(1);

          // KNOWN LIMITATION: masterKeyVersion hardcoded to 1 — multi-version key rotation not yet supported.
          // For now, use default version
          const credentialVersion = credentialVersionRow[0]?.masterKeyVersion ?? 1;
          const userVersion = 1; // Default version

          span.attributes["credential_master_key_version"] = credentialVersion;
          span.attributes["user_master_key_version"] = userVersion;

          // Check for version mismatch (stale passkey)
          if (credentialVersion < userVersion) {
            span.attributes["stale_passkey_detected"] = true;

            // Try to get escrow
            const escrow = await RotationEscrowService.getEscrow(user.id);

            if (escrow) {
              span.attributes["escrow_found"] = true;
              // Escrow exists and is not expired - re-wrap with current PRF key
              try {
                await PerCredentialPRFService.updatePRFKeyForCredential(
                  credential.id,
                  escrow.newMasterKey,
                  prfDerivedKey,
                  escrow.masterKeyVersion,
                );

                // Remove credential from escrow pending list
                await RotationEscrowService.removeCredentialFromEscrow(
                  user.id,
                  credential.id,
                );

                span.attributes["stale_passkey_rewrapped"] = true;
                useLogger(LoggerLevels.info, {
                  message: "Stale passkey re-wrapped successfully during login",
                  messageKey: "passkey.login.stale_rewrap_success",
                  section: loggerAppSections.PASSKEYS,
                  details: {
                    userId: user.id,
                    credentialIdPrefix: credential.id.substring(0, 8) + "...",
                  },
                });
              } finally {
                // Zero the master key buffer
                escrow.newMasterKey.fill(0);
              }
            } else {
              // Escrow expired or not found - set stale flag for client
              span.attributes["escrow_expired_or_not_found"] = true;
              stalePasskeyCredentialId = credential.id;

              useLogger(LoggerLevels.warn, {
                message: "Stale passkey detected but escrow expired - user needs to provide recovery phrase",
                messageKey: "passkey.login.stale_escrow_expired",
                section: loggerAppSections.PASSKEYS,
                details: {
                  userId: user.id,
                  credentialIdPrefix: credential.id.substring(0, 8) + "...",
                },
              });
            }
          }
        } catch (error) {
          // Log but don't fail the login - the user authenticated correctly
          span.attributes["stale_check_error"] = true;
          useLogger(LoggerLevels.error, {
            message: "Error checking stale passkey status during login",
            messageKey: "passkey.login.stale_check_error",
            section: loggerAppSections.PASSKEYS,
            details: { userId: user.id },
            raw: error,
          });
        }

        // Create session (no password-derived key for passkey auth)
        const sessionService = getSessionCreateService();
        const sessionResult = await sessionService.createUserSession(
          user.id,
          deviceInfo,
          ipAddress,
          honoContext,
          false,
          undefined,
        );

        try {
          // Cache PRF key with access token (short-lived, 15 minutes) using session key
          await PasskeyPRFService.cachePRFDerivedKey(
            sessionResult.accessToken,
            JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
            prfDerivedKeyBase64!,
            credential.id,
            sessionResult.sessionKey,
          );

          // Also store PRF key with refresh token (long-lived) for token refresh continuity using session key
          await EncryptionSystemUserService.storePRFDerivedKeyWithRefreshToken(
            sessionResult.refreshToken,
            JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
            prfDerivedKeyBase64!,
            credential.id,
            sessionResult.sessionKey,
          );
          span.attributes["prf_key_cached"] = true;
        } catch (error) {
          span.attributes["prf_key_cache_failed"] = true;

          const revocationService = getSessionRevocationService();
          await Promise.allSettled([
            revocationService.revokeJWTSession(
              sessionResult.accessToken,
            ),
            revocationService.revokeRefreshToken(
              sessionResult.refreshToken,
            ),
          ]);

          throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
        }

        await getUserAsymmetricKeysService().ensureKeyPairFromSession(
          user.id,
          sessionResult.accessToken,
          undefined,
          undefined,
          sessionResult.sessionKey,
          user.environmentId,
        );

        // Clean up login attempt
        await this.deleteLoginAttempt(attemptId);

        span.attributes["success"] = true;

        return {
          isAuthCompleted: true,
          message: "Passkey login successful",
          userId: user.id,
          environmentId: user.environmentId,
          displayName: `${user.firstName} ${user.lastName}`.trim(),
          accessToken: sessionResult.accessToken,
          refreshToken: sessionResult.refreshToken,
          expiresAt: sessionResult.expiresAt,
          refreshExpiresAt: sessionResult.refreshExpiresAt,
          sessionKey: sessionResult.sessionKey,
          stalePasskeyCredentialId,
        };
      },
    );
  }

  // --------------------
  // Private Helper Methods
  // --------------------

  /**
   * Gets passkey credentials for a user
   */
  private async getPasskeyCredentialsByUserId(
    userId: string,
  ): Promise<IStoredPasskeyCredential[]> {
    const db = getGlobalDB();
    const result = await db
      .select({
        id: globalTables.userPasskeys.id,
        publicKey: globalTables.userPasskeys.publicKey,
        counter: globalTables.userPasskeys.counter,
        backedUp: globalTables.userPasskeys.backedUp,
        transports: globalTables.userPasskeys.transports,
      })
      .from(globalTables.userPasskeys)
      .where(eq(globalTables.userPasskeys.userId, userId));

    return result.map((row) => ({
      ...row,
      transports: row.transports as AuthenticatorTransportFuture[] | null,
    }));
  }

  /**
   * Updates credential counter after authentication
   */
  private async updateCredentialCounter(
    credentialId: string,
    newCounter: number,
  ): Promise<void> {
    const db = getGlobalDB();
    await db
      .update(globalTables.userPasskeys)
      .set({ counter: newCounter })
      .where(eq(globalTables.userPasskeys.id, credentialId));
  }

  /**
   * Stores login attempt data in cache
   */
  private async storeLoginAttempt(
    attemptId: string,
    data: {
      userId: string;
      credentials: IStoredPasskeyCredential[];
    },
  ): Promise<void> {
    const { getCache, CACHE_NAMESPACES } = await import(
      "@services/cache/index.ts"
    );
    const cache = await getCache();

    const attemptKey = AuthServiceCacheKeys.generatePasskeyAttemptKey(
      attemptId,
    );
    await cache.set(
      CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
      attemptKey,
      data,
      { ttl: 120 }, // 2 minutes for login attempt
    );
  }

  /**
   * Retrieves login attempt data from cache
   */
  private async getLoginAttempt(attemptId: string): Promise<
    {
      userId: string;
      credentials: IStoredPasskeyCredential[];
    } | null
  > {
    const { getCache, CACHE_NAMESPACES } = await import(
      "@services/cache/index.ts"
    );
    const cache = await getCache();

    const attemptKey = AuthServiceCacheKeys.generatePasskeyAttemptKey(
      attemptId,
    );
    return await cache.get<{
      userId: string;
      credentials: IStoredPasskeyCredential[];
    }>(
      CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
      attemptKey,
    );
  }

  /**
   * Deletes login attempt data from cache
   */
  private async deleteLoginAttempt(attemptId: string): Promise<void> {
    const { getCache, CACHE_NAMESPACES } = await import(
      "@services/cache/index.ts"
    );
    const cache = await getCache();

    const attemptKey = AuthServiceCacheKeys.generatePasskeyAttemptKey(
      attemptId,
    );
    cache.delete(
      CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
      attemptKey,
    );
  }

  /**
   * Build PRF salt map for credentials
   */
  private async getPRFSaltsForCredentials(
    credentialIds: string[],
    userId: string,
    allowMissing = false,
  ): Promise<Record<string, string>> {
    const db = getGlobalDB();
    const rows = await db
      .select({
        credentialId: globalTables.passkeyPRFKeys.credentialId,
        prfSalt: globalTables.passkeyPRFKeys.prfSalt,
      })
      .from(globalTables.passkeyPRFKeys)
      .where(inArray(globalTables.passkeyPRFKeys.credentialId, credentialIds));

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.credentialId] = row.prfSalt;
    }

    const missing = credentialIds.filter((id) => !map[id]);
    if (missing.length > 0 && !allowMissing) {
      useLogger(LoggerLevels.error, {
        message: "Missing PRF salt for credential(s)",
        messageKey: "passkey.prf_salt_missing",
        section: loggerAppSections.PASSKEYS,
        details: { userId, missingCount: missing.length },
      });
      throwHttpError("ENCRYPTION.PRF_NOT_CONFIGURED_FOR_CREDENTIAL");
    }

    return map;
  }
}
