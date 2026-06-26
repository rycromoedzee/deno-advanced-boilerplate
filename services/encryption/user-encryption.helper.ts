/**
 * @file services/encryption/user-encryption.helper.ts
 * @description Helper functions for user encryption key management
 */

import { eq, hexToBytes } from "@deps";
import { AppHttpException, throwHttpError } from "../../utils/http-exception.ts";
import { CACHE_NAMESPACES, getCache } from "../cache/index.ts";
import { tokenHashString } from "../token/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "../logger/index.ts";
import { ITokensEncryptionData, ITokensRefreshTokenData, ITokensSessionData } from "../token/config.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "./encryption.helper.ts";
import { HASHING_CONTEXTS, PASSWORD_HASHING_CONFIG, TextHashing, TextTransformations } from "@utils/text/index.ts";
import { PasskeyPRFService } from "./passkey-prf.service.ts";
import { PerCredentialPRFService } from "./passkey-prf-credential.service.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { getSessionValidationService } from "@services/session/index.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
import { traced } from "@services/tracing/index.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { RefreshTokenRepository } from "@services/session/refresh-token.repository.ts";
import { generateSecureRandomBytes } from "@utils/security/secure-token.ts";

export class EncryptionSystemUserService {
  /**
   * Resolves the environment ID for a user from the global DB.
   * Callers that already know the environment ID (e.g. the login flow, which
   * loaded the user record) should pass it through to avoid this lookup — the
   * same `users.environment_id` row was being queried separately by several
   * methods on the same request.
   */
  private static async resolveEnvironmentId(userId: string): Promise<string> {
    const globalDb = getGlobalDB();
    const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1);

    if (!userRow) {
      throwHttpError("USER.NOT_FOUND");
    }

    return userRow.environmentId;
  }

  /**
   * Gets user master key for a given user
   * @deprecated since 1.5.0, will be removed in 2.0.0. Use getUserMasterKeyFromStorageWithPRF() to support passkey PRF keys.
   */
  static async getUserMasterKeyFromStorage(
    userId: string,
    passwordDerivedKey?: string,
    recoveryPhraseHash?: string,
  ): Promise<Uint8Array> {
    return await this.getUserMasterKeyFromStorageWithPRF(
      userId,
      passwordDerivedKey,
      undefined,
      recoveryPhraseHash,
    );
  }

  /**
   * Gets user master key using any available decryption method
   * Supports: password-derived key, PRF-derived key (for passkey users), and recovery phrase
   * @param userId - The user ID to get the master key for
   * @param passwordDerivedKey - Optional password-derived key
   * @param prfDerivedKey - Optional PRF-derived key (for passkey users)
   * @param recoveryPhraseHash - Optional recovery phrase hash
   * @returns Promise resolving to the user master key
   */
  static async getUserMasterKeyFromStorageWithPRF(
    userId: string,
    passwordDerivedKey?: string | Uint8Array,
    prfDerivedKey?: string | Uint8Array,
    recoveryPhraseHash?: string | Uint8Array,
    prfCredentialId?: string,
    environmentId?: string,
  ): Promise<Uint8Array> {
    return await traced("EncryptionSystemUserService.getUserMasterKeyFromStorageWithPRF", "service", async (span) => {
      span.attributes["user_id"] = userId;
      span.attributes["has_password_key"] = !!passwordDerivedKey;
      span.attributes["has_prf_key"] = !!prfDerivedKey;
      span.attributes["has_recovery_key"] = !!recoveryPhraseHash;
      span.attributes["has_prf_credential_id"] = !!prfCredentialId;

      if (!passwordDerivedKey && !prfDerivedKey && !recoveryPhraseHash) {
        throwHttpError("ENCRYPTION.INVALID_KEY");
      }

      try {
        const envId = environmentId ?? await this.resolveEnvironmentId(userId);

        const tenantDb = await getTenantDB(envId);
        const userData = await tenantDb.select({
          encryptedMasterKeyByPassword: tenantTables.userEncryption.encryptedMasterKeyByPassword,
          encryptedMasterKeyByRecoveryPhrase: tenantTables.userEncryption.encryptedMasterKeyByRecoveryPhrase,
        })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId))
          .limit(1);

        if (userData.length === 0) {
          throwHttpError("ENCRYPTION.DECRYPTION_FAILED");
        }

        const user = userData[0];
        span.attributes["has_password_encrypted"] = !!user.encryptedMasterKeyByPassword;
        span.attributes["has_recovery_encrypted"] = !!user.encryptedMasterKeyByRecoveryPhrase;

        if (passwordDerivedKey && user.encryptedMasterKeyByPassword) {
          try {
            const passwordKeyBytes = typeof passwordDerivedKey === "string"
              ? TextTransformations.base64ToBuffer(passwordDerivedKey)
              : passwordDerivedKey;

            const decryptedMasterKey = await useSymmetricDecrypt({
              key: passwordKeyBytes,
              data: user.encryptedMasterKeyByPassword as Uint8Array,
            });
            span.attributes["decryption_method"] = "password";
            return decryptedMasterKey;
          } catch (_error) {
            span.attributes["password_failed"] = true;
          }
        }

        if (prfDerivedKey && prfCredentialId) {
          try {
            const prfDerivedKeyBytes = typeof prfDerivedKey === "string"
              ? TextTransformations.base64ToBuffer(prfDerivedKey)
              : prfDerivedKey;

            const decryptedMasterKey = await PerCredentialPRFService.decryptWithDerivedKey(
              prfCredentialId,
              prfDerivedKeyBytes,
              userId,
            );

            span.attributes["decryption_method"] = "prf_per_credential";
            return decryptedMasterKey;
          } catch (_error) {
            span.attributes["prf_per_credential_failed"] = true;
          }
        }

        if (recoveryPhraseHash && user.encryptedMasterKeyByRecoveryPhrase) {
          try {
            const decryptedMasterKey = await useSymmetricDecrypt({
              key: typeof recoveryPhraseHash === "string" ? hexToBytes(recoveryPhraseHash) : recoveryPhraseHash,
              data: user.encryptedMasterKeyByRecoveryPhrase as Uint8Array,
            });
            span.attributes["decryption_method"] = "recovery";
            return decryptedMasterKey;
          } catch (_error) {
            span.attributes["recovery_failed"] = true;
          }
        }

        throwHttpError("ENCRYPTION.DECRYPTION_FAILED");
      } catch (error) {
        if (error instanceof AppHttpException) {
          throw error;
        }
        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  /**
   * Gets user master key for data encryption operations, supporting PRF-derived keys
   */
  static async getUserMasterKeyForDataEncryptionWithPRF(
    userId: string,
    accessToken: string,
    audience: string = JWT_TOKEN_CONFIG.audiences.auth,
    tokenType: JWT_TOKEN_TYPES = JWT_TOKEN_TYPES.AUTH,
    sessionKey?: string,
    environmentId?: string,
    preloadedSessionData?: ITokensSessionData | null,
  ): Promise<Uint8Array> {
    return await traced("EncryptionSystemUserService.getUserMasterKeyForDataEncryptionWithPRF", "service", async (span) => {
      span.attributes["user_id"] = userId;
      span.attributes["env_id_provided"] = !!environmentId;

      const passwordDerivedKey = await this.fetchPasswordDerivedKeyFromSession(
        accessToken,
        audience,
        tokenType,
        sessionKey,
        preloadedSessionData,
      );

      const prfDerivedKey = await PasskeyPRFService.fetchPRFDerivedKeyFromSession(accessToken, sessionKey);
      const prfCredentialId = await PasskeyPRFService.fetchPRFCredentialIdFromSession(accessToken);

      if (!passwordDerivedKey && !prfDerivedKey) {
        throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
      }

      return await this.getUserMasterKeyFromStorageWithPRF(
        userId,
        passwordDerivedKey ?? undefined,
        prfDerivedKey ?? undefined,
        undefined,
        prfCredentialId ?? undefined,
        environmentId,
      );
    });
  }

  static async storePasswordDerivedKeyInCache(
    token: string,
    ttl: number,
    derivedPasswordKey: string,
    sessionKey?: string,
  ): Promise<void> {
    return await traced("EncryptionSystemUserService.storePasswordDerivedKeyInCache", "service", async (_span) => {
      if (!derivedPasswordKey || derivedPasswordKey === "") {
        return;
      }

      try {
        const tokenHash = tokenHashString(token);
        const currentSession = await this.getSessionDataFromCache(tokenHash);

        if (!currentSession) {
          throwHttpError("SESSION.INVALID_SESSION");
        }

        const encryptedPasswordDerivedKey = await this.encryptDerivedKeyForStorage(
          derivedPasswordKey,
          tokenHash,
          sessionKey,
        );

        const encryptionData = {
          encryptedPasswordDerivedKey,
          lastAccessedAt: getTimeNow(),
          ipAddress: currentSession.ipAddress,
          userAgent: currentSession.deviceInfo.userAgent,
        } as ITokensEncryptionData;

        const updatedSession: ITokensSessionData = {
          ...currentSession,
          encryptionData,
        };

        await this.setSessionDataInCache(tokenHash, updatedSession, ttl);
      } catch (error) {
        if (error instanceof AppHttpException) {
          throw error;
        }
        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  private static async getUserSalt(userId: string, environmentId?: string): Promise<string> {
    try {
      const envId = environmentId ?? await this.resolveEnvironmentId(userId);

      const tenantDb = await traced(
        "EncryptionSystemUserService.getUserSalt.getTenantDB",
        "service",
        async () => await getTenantDB(envId),
      );
      const result = await tenantDb.select({
        salt: tenantTables.userEncryption.enhancedEncryptionSalt,
      }).from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      if (result.length !== 1) {
        const saltBytes = generateSecureRandomBytes(32);
        const newSalt = btoa(String.fromCharCode(...saltBytes));

        await tenantDb.insert(tenantTables.userEncryption).values({
          userId,
          enhancedEncryptionSalt: newSalt,
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
        });

        return newSalt;
      }

      const salt = result[0].salt;
      if (!salt) {
        const saltBytes = generateSecureRandomBytes(32);
        const newSalt = btoa(String.fromCharCode(...saltBytes));

        await tenantDb.update(tenantTables.userEncryption)
          .set({
            enhancedEncryptionSalt: newSalt,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(tenantTables.userEncryption.userId, userId));

        return newSalt;
      }

      return salt;
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }
      // caller owns logging
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  static async generatePasswordDerivedKey(
    password: string,
    userId: string,
    environmentId?: string,
  ): Promise<Uint8Array> {
    const salt = await this.getUserSalt(userId, environmentId);

    const passwordDerivedKey = await traced(
      "EncryptionSystemUserService.deriveEncryptionKeyFromPassword",
      "service",
      async () =>
        await TextHashing.deriveEncryptionKeyFromPassword(
          password,
          salt,
          PASSWORD_HASHING_CONFIG.ENCRYPTION,
          "",
        ),
    );

    const binaryString = atob(passwordDerivedKey);
    return new Uint8Array([...binaryString].map((char) => char.charCodeAt(0)));
  }

  static async fetchPasswordDerivedKeyFromSession(
    accessToken: string,
    audience: string,
    tokenType: JWT_TOKEN_TYPES,
    sessionKey?: string,
    preloadedSessionData?: ITokensSessionData | null,
  ): Promise<string | null> {
    try {
      // When the caller holds the session the auth middleware already validated
      // (threaded via context), reuse it and skip the second validateJWTSession.
      // That second call only re-verified the signature/revocation the
      // middleware already enforced, and its failure was swallowed into
      // ENCRYPTION.KEY_NOT_FOUND rather than acting as a real auth gate.
      const sessionData = preloadedSessionData ??
        await getSessionValidationService()
          .validateJWTSession(
            accessToken,
            audience,
            tokenType,
          );

      if (!sessionData?.encryptionData) {
        return null;
      }

      const { encryptedPasswordDerivedKey } = sessionData.encryptionData;
      if (!encryptedPasswordDerivedKey) {
        return null;
      }

      return await this.decryptDerivedKeyFromStorage(
        encryptedPasswordDerivedKey,
        tokenHashString(accessToken),
        sessionKey,
      );
    } catch (_error) {
      useLogger(LoggerLevels.warn, {
        message: `fetchPasswordDerivedKeyFromSession: exception caught`,
        section: loggerAppSections.ENCRYPTION,
        messageKey: "encryption.debug_session_exception",
        details: { error: _error instanceof Error ? _error.message : String(_error) },
      });
      return null;
    }
  }

  private static generateEncryptionKeyForPasswordDerivedKeyStorage(
    sessionKey: string | null | undefined,
    tokenHash: string,
  ): Uint8Array {
    if (sessionKey) {
      return TextHashing.generateHashFromString(
        `${sessionKey}:${tokenHash}`,
        HASHING_CONTEXTS.AUTH_SESSION_ENCRYPTION,
        32,
      );
    }
    return TextHashing.generateHashFromString(
      tokenHash,
      HASHING_CONTEXTS.AUTH_SESSION_ENCRYPTION,
      32,
    );
  }

  private static async encryptDerivedKeyForStorage(
    derivedKeyBase64: string,
    tokenHash: string,
    sessionKey?: string,
  ): Promise<string> {
    const encryptionKey = this.generateEncryptionKeyForPasswordDerivedKeyStorage(
      sessionKey,
      tokenHash,
    );
    const derivedKeyBytes = TextTransformations.base64ToBuffer(derivedKeyBase64);
    const encryptedData = await useSymmetricEncrypt({
      key: encryptionKey,
      data: derivedKeyBytes,
    });
    return TextTransformations.fromBufferToBase64(encryptedData);
  }

  private static async decryptDerivedKeyFromStorage(
    encryptedPasswordDerivedKey: string | Uint8Array,
    tokenHash: string,
    sessionKey?: string,
  ): Promise<string> {
    const encryptionKey = this.generateEncryptionKeyForPasswordDerivedKeyStorage(
      sessionKey,
      tokenHash,
    );
    const encryptedBytes = typeof encryptedPasswordDerivedKey === "string"
      ? TextTransformations.base64ToBuffer(encryptedPasswordDerivedKey)
      : encryptedPasswordDerivedKey;

    const decryptedPasswordDerivedKey = await useSymmetricDecrypt({
      key: encryptionKey,
      data: encryptedBytes,
    });

    return TextTransformations.fromBufferToBase64(decryptedPasswordDerivedKey);
  }

  private static async getSessionDataFromCache(
    tokenHash: string,
  ): Promise<ITokensSessionData | null> {
    return await (await getCache()).get<ITokensSessionData>(
      CACHE_NAMESPACES.AUTH.JWT_SESSION,
      tokenHash,
    );
  }

  private static async setSessionDataInCache(
    tokenHash: string,
    sessionData: ITokensSessionData,
    ttl: number,
  ): Promise<void> {
    await (await getCache()).set(
      CACHE_NAMESPACES.AUTH.JWT_SESSION,
      tokenHash,
      sessionData,
      { ttl },
    );
  }

  private static async getRefreshTokenDataFromCache(
    refreshTokenHash: string,
  ): Promise<ITokensRefreshTokenData | null> {
    return await (await getCache()).get<ITokensRefreshTokenData>(
      CACHE_NAMESPACES.AUTH.REFRESH_TOKENS,
      refreshTokenHash,
    );
  }

  private static async setRefreshTokenDataInCache(
    refreshTokenHash: string,
    refreshTokenData: ITokensRefreshTokenData,
    ttl: number,
  ): Promise<void> {
    await (await getCache()).set(
      CACHE_NAMESPACES.AUTH.REFRESH_TOKENS,
      refreshTokenHash,
      refreshTokenData,
      { ttl },
    );

    try {
      const repo = new RefreshTokenRepository();
      await repo.updateEncryptionFields(refreshTokenHash, {
        encryptedPasswordDerivedKey: refreshTokenData.encryptedPasswordDerivedKey ?? null,
        encryptedPRFDerivedKey: refreshTokenData.encryptedPRFDerivedKey ?? null,
        prfCredentialId: refreshTokenData.prfCredentialId ?? null,
      });
    } catch {
      // Non-critical — encryption fields in DB are for durability only
    }
  }

  static async cachePasswordDerivedKeysForMultipleUsers(
    token: string,
    tokenTTL: number,
    derivedKeys: Record<string, string>,
    sessionKey?: string,
  ): Promise<void> {
    if (!token || typeof token !== "string") {
      throwHttpError("VALIDATION.INVALID_FORMAT");
    }

    if (!derivedKeys || typeof derivedKeys !== "object" || Array.isArray(derivedKeys)) {
      return;
    }

    const userIds = Object.keys(derivedKeys);
    if (userIds.length === 0) {
      return;
    }

    try {
      const cache = await getCache();
      const tokenHash = tokenHashString(token);
      const encryptedDerivedKeys: Record<string, string> = {};

      for (const userId of userIds) {
        const derivedKey = derivedKeys[userId];
        if (!userId || !derivedKey) continue;

        try {
          encryptedDerivedKeys[userId] = await this.encryptDerivedKeyForStorage(
            derivedKey,
            tokenHash,
            sessionKey,
          );
        } catch (_error) {
          // Log partial failure
        }
      }

      if (Object.keys(encryptedDerivedKeys).length > 0) {
        await cache.set(
          CACHE_NAMESPACES.AUTH.JWT_SESSION,
          `derived_keys:${tokenHash}`,
          encryptedDerivedKeys,
          { ttl: tokenTTL },
        );
      } else {
        throwHttpError("ENCRYPTION.ENCRYPTION_FAILED");
      }
    } catch (error) {
      if (error instanceof AppHttpException) throw error;
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  static async storePasswordDerivedKeyWithRefreshToken(
    refreshToken: string,
    ttl: number,
    derivedPasswordKey: string,
    sessionKey?: string,
  ): Promise<void> {
    if (!derivedPasswordKey || derivedPasswordKey === "") return;

    try {
      const refreshTokenHash = tokenHashString(refreshToken);
      const refreshTokenData = await this.getRefreshTokenDataFromCache(refreshTokenHash);

      if (!refreshTokenData) return;

      const encryptedPasswordDerivedKey = await this.encryptDerivedKeyForStorage(
        derivedPasswordKey,
        refreshTokenHash,
        sessionKey,
      );

      const updatedRefreshTokenData: ITokensRefreshTokenData = {
        ...refreshTokenData,
        encryptedPasswordDerivedKey,
      };

      await this.setRefreshTokenDataInCache(refreshTokenHash, updatedRefreshTokenData, ttl);
    } catch (error) {
      if (error instanceof AppHttpException) throw error;
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  static async fetchPasswordDerivedKeyFromRefreshToken(
    refreshToken: string,
    sessionKey?: string,
  ): Promise<string | null> {
    if (!sessionKey) return null;

    try {
      const refreshTokenHash = tokenHashString(refreshToken);
      const refreshTokenData = await this.getRefreshTokenDataFromCache(refreshTokenHash);

      if (!refreshTokenData?.encryptedPasswordDerivedKey) return null;

      return await this.decryptDerivedKeyFromStorage(
        refreshTokenData.encryptedPasswordDerivedKey,
        refreshTokenHash,
        sessionKey,
      );
    } catch (_error) {
      return null;
    }
  }

  static async storePRFDerivedKeyWithRefreshToken(
    refreshToken: string,
    ttl: number,
    prfDerivedKey: string,
    prfCredentialId: string,
    sessionKey?: string,
  ): Promise<void> {
    if (!prfDerivedKey || prfDerivedKey === "") return;

    try {
      const refreshTokenHash = tokenHashString(refreshToken);
      const refreshTokenData = await this.getRefreshTokenDataFromCache(refreshTokenHash);

      if (!refreshTokenData) {
        throwHttpError("SESSION.INVALID_SESSION");
      }

      const encryptedPRFDerivedKey = await this.encryptDerivedKeyForStorage(
        prfDerivedKey,
        refreshTokenHash,
        sessionKey,
      );

      const updatedRefreshTokenData: ITokensRefreshTokenData = {
        ...refreshTokenData,
        encryptedPRFDerivedKey,
        prfCredentialId,
      };

      await this.setRefreshTokenDataInCache(refreshTokenHash, updatedRefreshTokenData, ttl);
    } catch (error) {
      if (error instanceof AppHttpException) throw error;
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  static async fetchPRFDerivedKeyFromRefreshToken(
    refreshToken: string,
    sessionKey?: string,
  ): Promise<{ prfDerivedKey: string; prfCredentialId: string } | null> {
    if (!sessionKey) return null;

    try {
      const refreshTokenHash = tokenHashString(refreshToken);
      const refreshTokenData = await this.getRefreshTokenDataFromCache(refreshTokenHash);

      if (!refreshTokenData?.encryptedPRFDerivedKey || !refreshTokenData.prfCredentialId) {
        return null;
      }

      const prfDerivedKey = await this.decryptDerivedKeyFromStorage(
        refreshTokenData.encryptedPRFDerivedKey,
        refreshTokenHash,
        sessionKey,
      );

      return {
        prfDerivedKey,
        prfCredentialId: refreshTokenData.prfCredentialId,
      };
    } catch (_error) {
      return null;
    }
  }

  static async clearCachedDerivedKeysForToken(token: string): Promise<void> {
    try {
      const cache = await getCache();
      const tokenHash = tokenHashString(token);
      await cache.delete(CACHE_NAMESPACES.AUTH.JWT_SESSION, `derived_keys:${tokenHash}`);
    } catch (_error) {
      // Non-fatal, just log it
      useLogger(LoggerLevels.warn, {
        message: "Failed to clear cached derived keys",
        messageKey: "encryption.user_helper.warn",
        section: loggerAppSections.AUTH,
        details: { error: _error instanceof Error ? _error.message : String(_error) },
      });
    }
  }
}
