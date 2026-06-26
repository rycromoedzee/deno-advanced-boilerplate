/**
 * @file services/public-sharing/public-sharing.service.ts
 * @description Public sharing service for database operations and encryption
 * Handles share creation, management, and access control
 *
 * ZERO-KNOWLEDGE ARCHITECTURE:
 * - shareId: Stored in database, used for share lookups
 * - shareKey: NEVER stored in plaintext, passed via URL fragment (#)
 * - Master key is encrypted with shareKey (not system key)
 * - If password is provided, master key is encrypted with key derived from BOTH shareKey + password
 * - sharerEncryptedShareKey allows the share creator to retrieve the full link later
 */

import { and, Buffer, eq, sql } from "@deps";
import { getTenantDB, requestContext } from "@db/index.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { DataAccessService, useSymmetricDecrypt, useSymmetricEncrypt } from "@services/encryption/index.ts";
import { PASSWORD_HASHING_CONFIG, TextHashing } from "@utils/text/index.ts";
import { HASHING_CONTEXTS, hashWithContext, type IHashingContext } from "@utils/text/hashing.ts";

import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";
import type { ExtendedPublicShareResult, PublicShareConfig, PublicShareInfo } from "@interfaces/public-sharing.ts";

import { SecureLinkGeneratorService, type ShareIdContext } from "./secure-link-generator.service.ts";
import { getTimeNow, getTimeNowForStorage } from "@utils/shared/index.ts";
import { loggerAppSections, LoggerLevels, useLogger, useLogSecurityEvent } from "@logger/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { RateLimitingService } from "@utils/auth/index.ts";

/** Rate limit configuration for public share password attempts */
const RATE_LIMIT_CONFIG = {
  maxAttempts: 5,
  windowSeconds: 5 * 60,
  blockDurationSeconds: 15 * 60,
  exponentialBase: 2,
  maxDelayMs: 15 * 1000,
  enableIPBasedAdjustment: true,
} as const;

const rateLimitServiceConfig = {
  maxAttempts: RATE_LIMIT_CONFIG.maxAttempts,
  windowMs: RATE_LIMIT_CONFIG.windowSeconds * 1000,
  blockDurationMs: RATE_LIMIT_CONFIG.blockDurationSeconds * 1000,
  exponentialBase: RATE_LIMIT_CONFIG.exponentialBase,
  maxDelayMs: RATE_LIMIT_CONFIG.maxDelayMs,
  enableIPBasedAdjustment: RATE_LIMIT_CONFIG.enableIPBasedAdjustment,
};

/**
 * Public sharing service that handles database operations and encryption
 * Uses SecureLinkGeneratorService for link generation and DataAccessService for shared operations
 */
export class PublicSharingService {
  public readonly linkGenerator = new SecureLinkGeneratorService();
  private readonly dataAccessService: DataAccessService;

  constructor(private tableConfig: IEncryptionTableConfig) {
    this.dataAccessService = new DataAccessService(tableConfig);
  }

  /**
   * Derives a deterministic key from password using shareId as unique salt
   */
  private async derivePublicSharePasswordKey(
    password: string,
    shareId: string,
  ): Promise<string> {
    const saltBytes = hashWithContext(shareId, HASHING_CONTEXTS.PUBLIC_SHARE, 32);
    const salt = Buffer.from(saltBytes).toString("base64");
    return await TextHashing.deriveEncryptionKeyFromPassword(
      password,
      salt,
      PASSWORD_HASHING_CONFIG.ENCRYPTION,
      "",
    );
  }

  /**
   * Derives an encryption key from the shareKey
   * This is used for zero-knowledge shares (no password)
   */
  private deriveEncryptionKeyFromShareKey(
    shareKey: string,
    encryptionType: IHashingContext,
  ): Uint8Array {
    // The shareKey is base64url encoded, convert to base64 for the hashing function
    const shareKeyBase64 = shareKey
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    return TextHashing.generateHashFromKeyForEncryption(shareKeyBase64, encryptionType);
  }

  /**
   * Derives an encryption key from BOTH shareKey and password
   * This provides defense-in-depth: link interception + password required
   */
  private async deriveEncryptionKeyFromShareKeyAndPassword(
    shareKey: string,
    password: string,
    shareId: string,
    encryptionType: IHashingContext,
  ): Promise<Uint8Array> {
    // First, derive a key from the password
    const passwordDerivedKey = await this.derivePublicSharePasswordKey(password, shareId);

    // Combine with shareKey for additional entropy
    const combinedKey = `${shareKey}:${passwordDerivedKey}`;

    // Hash the combined key using generateHashFromString which takes a string input
    return TextHashing.generateHashFromString(combinedKey, encryptionType, 32);
  }

  /**
   * Throws a rate limit exceeded error with Retry-After header
   */
  private throwPublicShareRateLimit(retryAfterSeconds: number): never {
    const response = new Response(null, {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(retryAfterSeconds)),
      },
    });

    throw new AppHttpException(429, {
      message: "Rate limit exceeded. Please try again later",
      messageKey: "rate-limit.exceeded",
      res: response,
    });
  }

  /**
   * Checks rate limit before password verification
   */
  private async checkPublicSharePasswordRateLimit(
    shareId: string,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const rateLimitKey = `public-share:${shareId}`;

    const [shareLimit, ipLimit] = await Promise.all([
      RateLimitingService.checkRateLimit(rateLimitKey, rateLimitServiceConfig, undefined, metadata?.userAgent),
      metadata?.ipAddress
        ? RateLimitingService.checkRateLimit(rateLimitKey, rateLimitServiceConfig, metadata.ipAddress, metadata.userAgent)
        : Promise.resolve(null),
    ]);

    if (shareLimit.shouldBlock) {
      this.throwPublicShareRateLimit(Math.max(0, shareLimit.nextAllowedAt - getTimeNow()));
    }

    if (ipLimit?.shouldBlock) {
      this.throwPublicShareRateLimit(Math.max(0, ipLimit.nextAllowedAt - getTimeNow()));
    }
  }

  /**
   * Records a failed password attempt and applies progressive delay
   */
  private async recordPublicSharePasswordAttempt(
    shareId: string,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const rateLimitKey = `public-share:${shareId}`;

    const [shareResult, ipResult] = await Promise.all([
      RateLimitingService.recordAttempt(rateLimitKey, rateLimitServiceConfig, undefined, metadata?.userAgent),
      metadata?.ipAddress
        ? RateLimitingService.recordAttempt(rateLimitKey, rateLimitServiceConfig, metadata.ipAddress, metadata.userAgent)
        : Promise.resolve(null),
    ]);

    const delayMs = Math.max(shareResult.delayMs, ipResult?.delayMs || 0);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (shareResult.shouldBlock) {
      this.throwPublicShareRateLimit(Math.max(0, shareResult.nextAllowedAt - getTimeNow()));
    }

    if (ipResult?.shouldBlock) {
      this.throwPublicShareRateLimit(Math.max(0, ipResult.nextAllowedAt - getTimeNow()));
    }
  }

  /**
   * Create a public share for a resource with zero-knowledge secure link generation
   * @param resourceId Resource identifier
   * @param userId User creating the share
   * @param config Public share configuration
   * @param encryptionType Encryption context type for this resource type
   * @param encryptionKey Key to decrypt the user's master key
   * @param environmentId Environment ID for tenant DB routing (encoded in share token)
   * @returns Public share result with secure URLs
   */
  async createPublicShare(
    resourceId: string,
    userId: string,
    config: PublicShareConfig,
    encryptionType: IHashingContext,
    encryptionKey: Uint8Array,
    environmentId?: string,
  ): Promise<ExtendedPublicShareResult> {
    return await tracedWithServiceErrorHandling(
      "PublicSharingService.createPublicShare",
      {
        service: "PublicSharingService",
        method: "createPublicShare",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { resourceId, userId, encryptionType },
      },
      "PUBLIC_SHARE.CREATE_FAILED",
      async (span) => {
        span.attributes["resource_id"] = resourceId;
        span.attributes["user_id"] = userId;
        span.attributes["encryption_type"] = encryptionType;
        span.attributes["has_password"] = !!config.password;
        span.attributes["has_expiration"] = !!config.expiresAt;

        // Check if user has permission to share
        const permissionCheck = await this.dataAccessService.checkPermission(
          resourceId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE,
        );

        if (!permissionCheck.hasPermission) {
          span.attributes["failure_reason"] = "permission_denied";
          // Use NOT_FOUND to prevent information disclosure
          throwHttpError("PUBLIC_SHARE.NOT_FOUND");
        }

        // Get the user's encrypted master key
        const userKeyData = await (await getTenantDB())
          .select()
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.userId, userId),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        if (userKeyData.length === 0) {
          throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
        }

        const encryptedDataMasterKey = userKeyData[0].encryptedMasterKey as Uint8Array;
        const dataMasterKey = await useSymmetricDecrypt({
          key: encryptionKey,
          data: encryptedDataMasterKey,
        });

        // Get environmentId from parameter or request context
        const envId = environmentId || requestContext.getStore()?.environmentId;
        if (!envId) {
          span.attributes["failure_reason"] = "missing_environment_id";
          throwHttpError("PUBLIC_SHARE.CREATE_FAILED");
        }

        // Generate zero-knowledge secure link components
        const context: ShareIdContext = {
          userId,
          resourceId,
          timestamp: getTimeNow(),
          environmentId: envId,
        };

        const secureLink = await this.linkGenerator.createSecurePublicUri(context, {
          shareIdBits: 512,
          shareKeyBits: 512,
        });

        const shareId = secureLink.shareId; // Full shareId with env prefix (for URL)
        const shareToken = secureLink.shareToken; // Actual token for DB storage
        const shareKey = secureLink.shareKey;

        // Re-encrypt the data master key using shareKey (and password if provided)
        // ZERO-KNOWLEDGE: Master key is encrypted with shareKey, NOT system key
        // NOTE: We use the bare shareToken (not the full env-prefixed shareId) as
        // the password-salt input so the value matches what verifyPublicSharePassword
        // and getDataMasterKeyForPublicShare see at decrypt time (both look up by
        // publicShareToken which is the bare token). Using the full shareId here
        // would mismatch and password-protected shares would fail to decrypt.
        const { publicEncryptionMode, publicEncryptedMasterKey } = config.password
          ? await this.encryptWithShareKeyAndPassword(dataMasterKey, shareKey, config.password, shareToken, encryptionType)
          : await this.encryptWithShareKey(dataMasterKey, shareKey, encryptionType);

        // Encrypt the shareKey with the sharer's key so they can retrieve the link later
        const sharerEncryptedShareKey = await this.encryptShareKeyForSharer(shareKey, encryptionKey, encryptionType);

        // Store the public share record
        // Note: We store shareToken (actual token without env prefix) in DB
        // The full shareId with env prefix is returned to the caller for URLs
        await this.storePublicShareRecord({
          resourceId,
          encryptedMasterKey: publicEncryptedMasterKey,
          encryptionMode: publicEncryptionMode,
          permissionLevel: config.permissionLevel || DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
          grantedBy: userId,
          shareId: shareToken, // Store only the actual token (without env prefix)
          sharerEncryptedShareKey,
          expiresAt: config.expiresAt,
          recipientEmail: config.recipientEmail,
          recipientName: config.recipientName,
          recipientLanguage: config.recipientLanguage || "en",
          isPasswordProtected: !!config.password,
          notifyOnAccess: config.notifyOnAccess || false,
        });

        span.attributes["success"] = true;
        span.attributes["encryption_mode"] = publicEncryptionMode;

        return {
          shareToken: shareId, // Backward compatibility
          shareId,
          expiresAt: config.expiresAt,
          isPasswordProtected: !!config.password,
          publicUri: secureLink.publicUri,
          volumeId: secureLink.shareId, // Backward compatibility
          linkId: secureLink.shareKey, // Backward compatibility (NOTE: this is the raw shareKey, handle carefully!
        };
      },
    );
  }

  /**
   * Encrypts master key with shareKey only (no password - zero-knowledge unprotected)
   */
  private async encryptWithShareKey(
    dataMasterKey: Uint8Array,
    shareKey: string,
    encryptionType: IHashingContext,
  ): Promise<{
    publicEncryptionMode: DB_ENUM_ENCRYPTION_MODE;
    publicEncryptedMasterKey: Uint8Array;
  }> {
    const encryptionKey = this.deriveEncryptionKeyFromShareKey(shareKey, encryptionType);

    return {
      publicEncryptionMode: DB_ENUM_ENCRYPTION_MODE.PUBLIC_UNPROTECTED,
      publicEncryptedMasterKey: await useSymmetricEncrypt({
        key: encryptionKey,
        data: dataMasterKey,
      }),
    };
  }

  /**
   * Encrypts master key with BOTH shareKey and password (defense-in-depth)
   */
  private async encryptWithShareKeyAndPassword(
    dataMasterKey: Uint8Array,
    shareKey: string,
    password: string,
    shareId: string,
    encryptionType: IHashingContext,
  ): Promise<{
    publicEncryptionMode: DB_ENUM_ENCRYPTION_MODE;
    publicEncryptedMasterKey: Uint8Array;
  }> {
    const encryptionKey = await this.deriveEncryptionKeyFromShareKeyAndPassword(
      shareKey,
      password,
      shareId,
      encryptionType,
    );

    return {
      publicEncryptionMode: DB_ENUM_ENCRYPTION_MODE.PASSWORD_PROTECTED_PUBLIC,
      publicEncryptedMasterKey: await useSymmetricEncrypt({
        key: encryptionKey,
        data: dataMasterKey,
      }),
    };
  }

  /**
   * Encrypts the shareKey with the sharer's key so they can retrieve the full link later
   */
  private async encryptShareKeyForSharer(
    shareKey: string,
    sharerEncryptionKey: Uint8Array,
    encryptionType: IHashingContext,
  ): Promise<Uint8Array> {
    const shareKeyBytes = new TextEncoder().encode(shareKey);
    // Use generateHashFromKey which accepts Uint8Array directly
    const derivedKey = TextHashing.generateHashFromKey(
      sharerEncryptionKey,
      encryptionType,
      32,
    );

    return await useSymmetricEncrypt({
      key: derivedKey,
      data: shareKeyBytes,
    });
  }

  /**
   * Decrypts the shareKey using the sharer's key (for link retrieval)
   */
  async decryptShareKeyForSharer(
    sharerEncryptedShareKey: Uint8Array,
    sharerEncryptionKey: Uint8Array,
    encryptionType: IHashingContext,
  ): Promise<string> {
    // Use generateHashFromKey which accepts Uint8Array directly
    const derivedKey = TextHashing.generateHashFromKey(
      sharerEncryptionKey,
      encryptionType,
      32,
    );

    const decryptedBytes = await useSymmetricDecrypt({
      key: derivedKey,
      data: sharerEncryptedShareKey,
    });

    return new TextDecoder().decode(decryptedBytes);
  }

  /**
   * Revoke a public share
   * @param resourceId Resource identifier
   * @param shareId Share ID to revoke
   * @param userId User revoking the share
   */
  async revokePublicShare(
    resourceId: string,
    shareId: string,
    userId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PublicSharingService.revokePublicShare",
      {
        service: "PublicSharingService",
        method: "revokePublicShare",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { resourceId, userId },
      },
      "PUBLIC_SHARE.REVOKE_FAILED",
      async () => {
        // Check if user has permission to manage shares
        const permissionCheck = await this.dataAccessService.checkPermission(
          resourceId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE,
        );

        if (!permissionCheck.hasPermission) {
          // Use NOT_FOUND to prevent information disclosure
          throwHttpError("PUBLIC_SHARE.NOT_FOUND");
        }

        // Find and revoke the public share
        const _result = await (await getTenantDB())
          .update(this.tableConfig.tableName)
          .set({
            isActive: false,
            revokedAt: getTimeNowForStorage(),
            updatedAt: getTimeNowForStorage(),
          })
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.publicShareToken, shareId),
              eq(this.tableConfig.tableName.isPublicShare, true),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          );

        // SQLite doesn't support rowCount, so we skip this check
        // The update should not fail even if no rows are affected
      },
    );
  }

  /**
   * Get public share information by share ID
   * @param shareId Share ID
   * @returns Public share data or throws if not found/expired
   */
  async getPublicShare(shareId: string): Promise<PublicShareInfo> {
    return await tracedWithServiceErrorHandling(
      "PublicSharingService.getPublicShare",
      {
        service: "PublicSharingService",
        method: "getPublicShare",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { shareId: shareId.substring(0, 8) + "..." },
      },
      "PUBLIC_SHARE.GET_FAILED",
      async () => {
        const shareData = await (await getTenantDB())
          .select({
            resourceId: this.tableConfig.tableName[this.tableConfig.resourceIdColumn],
            permissionLevel: this.tableConfig.tableName.permissionLevel,
            isPasswordProtected: this.tableConfig.tableName.isPasswordProtected,
            publicShareExpiresAt: this.tableConfig.tableName.publicShareExpiresAt,
            recipientEmail: this.tableConfig.tableName.recipientEmail,
            recipientName: this.tableConfig.tableName.recipientName,
            recipientLanguage: this.tableConfig.tableName.recipientLanguage,
          })
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName.publicShareToken, shareId),
              eq(this.tableConfig.tableName.isPublicShare, true),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        if (shareData.length === 0) {
          throwHttpError("PUBLIC_SHARE.NOT_FOUND");
        }

        const share = shareData[0];

        // Check if share has expired - use NOT_FOUND to prevent information disclosure
        if (share.publicShareExpiresAt && share.publicShareExpiresAt < getTimeNowForStorage()) {
          throwHttpError("PUBLIC_SHARE.NOT_FOUND");
        }

        return {
          resourceId: share.resourceId as string,
          permissionLevel: share.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
          isPasswordProtected: share.isPasswordProtected as boolean,
          expiresAt: share.publicShareExpiresAt as number | undefined,
          recipientEmail: share.recipientEmail as string | undefined,
          recipientName: share.recipientName as string | undefined,
          recipientLanguage: share.recipientLanguage as string | undefined,
        };
      },
    );
  }

  /**
   * Verify password for password-protected public share by attempting decryption
   * ZERO-KNOWLEDGE: Requires both shareKey and password
   * @param shareId Share ID
   * @param shareKey Share key (from URL fragment)
   * @param password Password to verify
   * @param encryptionType Encryption context type
   * @param metadata Optional metadata for rate limiting
   * @returns True if password is correct (can decrypt the data master key)
   */
  async verifyPublicSharePassword(
    shareId: string,
    shareKey: string,
    password: string,
    encryptionType: IHashingContext,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "PublicSharingService.verifyPublicSharePassword",
      {
        service: "PublicSharingService",
        method: "verifyPublicSharePassword",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { shareId: shareId.substring(0, 8) + "..." },
      },
      "PUBLIC_SHARE.VERIFY_PASSWORD_FAILED",
      async () => {
        await this.checkPublicSharePasswordRateLimit(shareId, metadata);

        const shareData = await (await getTenantDB())
          .select({
            resourceId: this.tableConfig.tableName[this.tableConfig.resourceIdColumn],
            encryptedMasterKey: this.tableConfig.tableName.encryptedMasterKey,
            publicShareExpiresAt: this.tableConfig.tableName.publicShareExpiresAt,
          })
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName.publicShareToken, shareId),
              eq(this.tableConfig.tableName.isPublicShare, true),
              eq(this.tableConfig.tableName.isPasswordProtected, true),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        if (shareData.length === 0) {
          throwHttpError("PUBLIC_SHARE.NOT_FOUND");
        }

        const share = shareData[0];

        // Check if share has expired - use NOT_FOUND to prevent information disclosure
        if (share.publicShareExpiresAt && share.publicShareExpiresAt < getTimeNowForStorage()) {
          throwHttpError("PUBLIC_SHARE.NOT_FOUND");
        }

        const resourceId = share.resourceId as string;
        const encryptedMasterKey = share.encryptedMasterKey as Uint8Array;

        // Derive key from BOTH shareKey and password
        const decryptionKey = await this.deriveEncryptionKeyFromShareKeyAndPassword(
          shareKey,
          password,
          shareId,
          encryptionType,
        );

        // Attempt decryption - if it succeeds, password is correct
        try {
          await useSymmetricDecrypt({
            key: decryptionKey,
            data: encryptedMasterKey,
          });
          await RateLimitingService.resetRateLimit(`public-share:${shareId}`, metadata?.ipAddress);
          return true;
        } catch {
          await this.logFailedPasswordAttempt(shareId, resourceId);
          await this.recordPublicSharePasswordAttempt(shareId, metadata);
          return false;
        }
      },
    );
  }

  /**
   * Get decrypted data master key for public share access
   * ZERO-KNOWLEDGE: Requires shareKey (and password if protected)
   * @param shareId Share ID
   * @param shareKey Share key (from URL fragment via Share-Key header)
   * @param encryptionType Encryption context type
   * @param password Optional password for password-protected shares
   * @returns Decrypted data master key
   */
  async getDataMasterKeyForPublicShare(
    shareId: string,
    shareKey: string,
    encryptionType: IHashingContext,
    password?: string,
  ): Promise<Uint8Array> {
    return await tracedWithServiceErrorHandling(
      "PublicSharingService.getDataMasterKeyForPublicShare",
      {
        service: "PublicSharingService",
        method: "getDataMasterKeyForPublicShare",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { shareId: shareId.substring(0, 8) + "..." },
      },
      "PUBLIC_SHARE.GET_MASTER_KEY_FAILED",
      async () => {
        const shareData = await (await getTenantDB())
          .select({
            encryptedMasterKey: this.tableConfig.tableName.encryptedMasterKey,
            encryptionMode: this.tableConfig.tableName.encryptionMode,
            publicShareExpiresAt: this.tableConfig.tableName.publicShareExpiresAt,
            isPasswordProtected: this.tableConfig.tableName.isPasswordProtected,
          })
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName.publicShareToken, shareId),
              eq(this.tableConfig.tableName.isPublicShare, true),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        if (shareData.length === 0) {
          throwHttpError("PUBLIC_SHARE.NOT_FOUND");
        }

        const share = shareData[0];

        // Check if share has expired - use NOT_FOUND to prevent information disclosure
        if (share.publicShareExpiresAt && share.publicShareExpiresAt < getTimeNowForStorage()) {
          throwHttpError("PUBLIC_SHARE.NOT_FOUND");
        }

        const encryptedMasterKey = share.encryptedMasterKey as Uint8Array;
        const encryptionMode = share.encryptionMode as DB_ENUM_ENCRYPTION_MODE;

        switch (encryptionMode) {
          case DB_ENUM_ENCRYPTION_MODE.PASSWORD_PROTECTED_PUBLIC: {
            if (!password) {
              throwHttpError("PUBLIC_SHARE.PASSWORD_REQUIRED");
            }

            // Decrypt using key derived from BOTH shareKey and password
            const decryptionKey = await this.deriveEncryptionKeyFromShareKeyAndPassword(
              shareKey,
              password,
              shareId,
              encryptionType,
            );

            try {
              return await useSymmetricDecrypt({
                key: decryptionKey,
                data: encryptedMasterKey,
              });
            } catch {
              throwHttpError("PUBLIC_SHARE.INVALID_PASSWORD");
            }
            break;
          }

          case DB_ENUM_ENCRYPTION_MODE.PUBLIC_UNPROTECTED: {
            // Decrypt using key derived from shareKey only (zero-knowledge)
            const decryptionKey = this.deriveEncryptionKeyFromShareKey(shareKey, encryptionType);

            try {
              return await useSymmetricDecrypt({
                key: decryptionKey,
                data: encryptedMasterKey,
              });
            } catch {
              // Invalid shareKey - this shouldn't happen with a valid link
              throwHttpError("PUBLIC_SHARE.INVALID_SHARE_KEY");
            }
            break;
          }

          default:
            throwHttpError("ENCRYPTION.UNSUPPORTED_MODE");
        }
      },
    );
  }

  /**
   * Update access count for public share
   * @param shareId Share ID
   */
  async incrementPublicShareAccessCount(shareId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PublicSharingService.incrementPublicShareAccessCount",
      {
        service: "PublicSharingService",
        method: "incrementPublicShareAccessCount",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { shareId: shareId.substring(0, 8) + "..." },
      },
      "PUBLIC_SHARE.GET_FAILED",
      async () => {
        await (await getTenantDB())
          .update(this.tableConfig.tableName)
          .set({
            accessCount: sql`${this.tableConfig.tableName.accessCount} + 1`,
            lastAccessedAt: getTimeNowForStorage(),
            updatedAt: getTimeNowForStorage(),
          })
          .where(
            and(
              eq(this.tableConfig.tableName.publicShareToken, shareId),
              eq(this.tableConfig.tableName.isPublicShare, true),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          );
      },
    );
  }

  /**
   * Stores a public share record with all public sharing specific fields
   */
  private async storePublicShareRecord({
    resourceId,
    encryptedMasterKey,
    encryptionMode,
    permissionLevel,
    grantedBy,
    shareId,
    sharerEncryptedShareKey,
    expiresAt,
    recipientEmail,
    recipientName,
    recipientLanguage,
    isPasswordProtected,
    notifyOnAccess,
  }: {
    resourceId: string;
    encryptedMasterKey: Uint8Array;
    encryptionMode: DB_ENUM_ENCRYPTION_MODE;
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
    grantedBy: string;
    shareId: string;
    sharerEncryptedShareKey: Uint8Array;
    expiresAt?: number | null;
    recipientEmail?: string;
    recipientName?: string;
    recipientLanguage: string;
    isPasswordProtected: boolean;
    notifyOnAccess: boolean;
  }): Promise<void> {
    await (await getTenantDB()).insert(this.tableConfig.tableName).values({
      id: generateIdRandom(),
      [this.tableConfig.resourceIdColumn]: resourceId,
      userId: null, // Public shares don't have a specific user
      encryptedMasterKey,
      encryptionMode,
      permissionLevel,
      isActive: true,
      keyVersion: 1,
      grantedAt: getTimeNowForStorage(),
      grantedBy,
      isPublicShare: true,
      publicShareToken: shareId,
      publicShareExpiresAt: expiresAt,
      sharerEncryptedShareKey,
      recipientEmail,
      recipientName,
      recipientLanguage,
      isPasswordProtected,
      notifyOnAccess,
      accessCount: 0,
      createdAt: getTimeNowForStorage(),
      updatedAt: getTimeNowForStorage(),
    });
  }

  /**
   * Log security event for failed password attempts on public shares
   */
  private async logFailedPasswordAttempt(
    shareId: string,
    resourceId: string,
  ): Promise<void> {
    try {
      await useLogSecurityEvent(
        LoggerLevels.info,
        "Public Share Password Attempt Failed",
        "medium",
        loggerAppSections.PUBLIC_SHARE,
        "PUBLIC_SHARE.PASSWORD_FAILED",
        {
          shareId: shareId.substring(0, 8) + "...",
          resourceId,
          timestamp: new Date().toISOString(),
          component: "PublicSharingService",
          action: "password_verification",
        },
      );
    } catch (error) {
      useLogger(LoggerLevels.warn, {
        message: "Failed to log public share password attempt",
        messageKey: "public_sharing.log_failed_attempt.error",
        section: loggerAppSections.PUBLIC_SHARE,
        raw: error,
      });
    }
  }
}
