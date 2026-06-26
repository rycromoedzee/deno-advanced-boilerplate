/**
 * @file services/auth/passkey-reauth-token.service.ts
 * @description Secure, single-use reauth token handling for passkey operations
 */

import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { tokenHashString } from "@services/token/index.ts";
import { HASHING_CONTEXTS, TextHashing, TextTransformations } from "@utils/text/index.ts";
import { bytesToHex } from "@deps";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { envConfig } from "@config/env.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { generateSecureTokenBase64Url } from "@utils/security/secure-token.ts";

interface ReauthTokenData {
  tokenHashPrefix: string;
  userId: string;
  sessionId: string;
  purpose: "passkey_add" | "passkey_delete" | "password_set";
  encryptedMasterKey: string;
  ipAddress: string;
  createdAt: number;
  expiresAt: number;
}

export class SecureReauthTokenService {
  private static readonly TTL_SECONDS = 300;

  static async generateToken(params: {
    userId: string;
    sessionId: string;
    purpose: "passkey_add" | "passkey_delete" | "password_set";
    masterKey: Uint8Array;
    ipAddress: string;
  }): Promise<{ token: string; expiresAt: number }> {
    const rawToken = generateSecureTokenBase64Url(32);
    const tokenHash = tokenHashString(rawToken);

    const encryptionKey = this.deriveEncryptionKey(
      tokenHash,
      params.sessionId,
      params.purpose,
    );

    const encryptedMasterKey = await useSymmetricEncrypt({
      key: encryptionKey,
      data: params.masterKey,
    });

    const cache = await getCache();
    const now = Date.now();
    const expiresAt = now + this.TTL_SECONDS * 1000;

    await cache.set(
      CACHE_NAMESPACES.AUTH.REAUTH_TOKENS,
      tokenHash,
      {
        tokenHashPrefix: tokenHash.substring(0, 8),
        userId: params.userId,
        sessionId: params.sessionId,
        purpose: params.purpose,
        encryptedMasterKey: TextTransformations.fromBufferToBase64(
          encryptedMasterKey,
        ),
        ipAddress: params.ipAddress,
        createdAt: now,
        expiresAt,
      } satisfies ReauthTokenData,
      { ttl: this.TTL_SECONDS },
    );

    return { token: rawToken, expiresAt };
  }

  static async consumeToken(params: {
    token: string;
    userId: string;
    sessionId: string;
    purpose: "passkey_add" | "passkey_delete" | "password_set";
    ipAddress?: string;
  }): Promise<Uint8Array> {
    const tokenHash = tokenHashString(params.token);
    const cache = await getCache();

    const data = await cache.getAndDelete<ReauthTokenData>(
      CACHE_NAMESPACES.AUTH.REAUTH_TOKENS,
      tokenHash,
    );

    if (!data) {
      useLogger(LoggerLevels.warn, {
        message: "Reauth token not found or already consumed",
        messageKey: "reauth.token_not_found",
        section: loggerAppSections.AUTH,
        details: { tokenHashPrefix: tokenHash.substring(0, 8) },
      });
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    if (Date.now() > data.expiresAt) {
      throwHttpError("AUTH.SESSION_EXPIRED");
    }

    if (data.userId !== params.userId) {
      this.logBindingMismatch("userId", data.userId, params.userId);
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    if (data.sessionId !== params.sessionId) {
      this.logBindingMismatch("sessionId", data.sessionId, params.sessionId);
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    if (data.purpose !== params.purpose) {
      this.logBindingMismatch("purpose", data.purpose, params.purpose);
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    if (params.ipAddress && data.ipAddress && data.ipAddress !== params.ipAddress) {
      useLogger(LoggerLevels.warn, {
        message: "Reauth token IP mismatch (log-only)",
        messageKey: "reauth.ip_mismatch",
        section: loggerAppSections.AUTH,
        details: { tokenHashPrefix: tokenHash.substring(0, 8) },
      });
    }

    const encryptionKey = this.deriveEncryptionKey(
      tokenHash,
      params.sessionId,
      params.purpose,
    );
    const encryptedMasterKey = TextTransformations.base64ToBuffer(
      data.encryptedMasterKey,
    );

    return await useSymmetricDecrypt({
      key: encryptionKey,
      data: encryptedMasterKey,
    });
  }

  private static deriveEncryptionKey(
    tokenHash: string,
    sessionId: string,
    purpose: string,
  ): Uint8Array {
    const cacheSecret = TextHashing.generateHashFromKeyForCacheEncryption(
      envConfig.auth.generalEncryptionKey!,
    );
    const cacheSecretHex = bytesToHex(cacheSecret);

    return TextHashing.generateHashFromString(
      `reauth:${cacheSecretHex}:${tokenHash}:${sessionId}:${purpose}`,
      HASHING_CONTEXTS.AUTH_SESSION_ENCRYPTION,
      32,
    );
  }

  private static logBindingMismatch(
    field: string,
    expected: string,
    _actual: string,
  ): void {
    useLogger(LoggerLevels.warn, {
      message: `Reauth token ${field} mismatch`,
      messageKey: "reauth.binding_mismatch",
      section: loggerAppSections.AUTH,
      details: { field, expectedPrefix: expected.substring(0, 8) },
    });
  }
}
