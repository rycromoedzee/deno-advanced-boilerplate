/**
 * @file services/encryption/data-access.service.ts
 * @description Data Access service (encryption)
 */
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { and, eq, inArray } from "@deps";
import { KeySharingService } from "./key-sharing.service.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "./encryption.helper.ts";
import { EncryptionSystemUserService } from "./user-encryption.helper.ts";
import { type ITokensSessionData, tokenHashString } from "@services/token/index.ts";
import { useGetCookie } from "@utils/cookie.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { envConfig } from "@config/env.ts";
import type { HonoContext } from "@deps";

import { type DynamicColumnTable, IEncryptionTableConfig, PermissionCheckResult } from "@interfaces/encryption.ts";
import { TextHashing, TextTransformations } from "@utils/text/index.ts";
import type { IHashingContext } from "@utils/text/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { getUserAsymmetricKeysService } from "../user/index.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

function buildActiveResourceQuery(
  tableName: DynamicColumnTable,
  resourceIdColumn: string,
  resourceId: string,
  userId: string,
) {
  return and(
    eq(tableName[resourceIdColumn], resourceId),
    eq(tableName.userId, userId),
    eq(tableName.isActive, true),
  );
}

interface StoreEncryptedMasterKeyParams {
  resourceId: string;
  userId: string;
  encryptedMasterKey: Uint8Array;
  thumbnailEncryptedMasterKey?: Uint8Array | null;
  encryptionMode: DB_ENUM_ENCRYPTION_MODE;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  grantedBy: string;
}

export class DataAccessService {
  private keySharingService = new KeySharingService();
  private asymmetricKeysService = getUserAsymmetricKeysService();

  constructor(private tableConfig: IEncryptionTableConfig) {}

  async shareDataWithUserKey(
    resourceId: string,
    ownerId: string,
    ownerUserMasterKey: Uint8Array,
    targetUserId: string,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL = DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DataAccessService.shareDataWithUserKey",
      {
        service: "DataAccessService",
        method: "shareDataWithUserKey",
        section: loggerAppSections.ENCRYPTION,
        details: { resourceId, ownerId, targetUserId },
      },
      "ENCRYPTION.ENCRYPTION_FAILED",
      async () => {
        const db = await getTenantDB();
        const [ownerKeyData, targetUserKeyPair] = await Promise.all([
          db
            .select({
              encryptedMasterKey: this.tableConfig.tableName.encryptedMasterKey,
              thumbnailEncryptedMasterKey: this.tableConfig.tableName.thumbnailEncryptedMasterKey,
            })
            .from(this.tableConfig.tableName)
            .where(
              buildActiveResourceQuery(
                this.tableConfig.tableName,
                this.tableConfig.resourceIdColumn,
                resourceId,
                ownerId,
              ),
            )
            .limit(1),
          this.asymmetricKeysService.getUserKeyPair(targetUserId),
        ]);

        if (ownerKeyData.length === 0) {
          throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
        }

        const ownerEncryptedDataMasterKey = ownerKeyData[0].encryptedMasterKey as Uint8Array;
        const ownerThumbnailEncryptedMasterKey = ownerKeyData[0].thumbnailEncryptedMasterKey as Uint8Array | null | undefined;

        if (!targetUserKeyPair) {
          throwHttpError("USER.NOT_FOUND");
        }

        const targetUserEncryptedDataMasterKey = await this.keySharingService.shareDataMasterKeyAsymmetric(
          ownerEncryptedDataMasterKey,
          ownerUserMasterKey,
          targetUserKeyPair.publicKey,
        );

        let targetUserEncryptedThumbnailMasterKey: Uint8Array | undefined;
        if (ownerThumbnailEncryptedMasterKey) {
          targetUserEncryptedThumbnailMasterKey = await this.keySharingService.shareDataMasterKeyAsymmetric(
            ownerThumbnailEncryptedMasterKey,
            ownerUserMasterKey,
            targetUserKeyPair.publicKey,
          );
        }

        await this.storeEncryptedMasterKey({
          resourceId,
          userId: targetUserId,
          encryptedMasterKey: targetUserEncryptedDataMasterKey,
          thumbnailEncryptedMasterKey: targetUserEncryptedThumbnailMasterKey,
          encryptionMode: DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
          permissionLevel,
          grantedBy: ownerId,
        });
      },
    );
  }

  async shareDataWithAppKey(
    resourceId: string,
    ownerId: string,
    targetUserId: string,
    appKey: string,
    encryptionType: IHashingContext,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL = DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DataAccessService.shareDataWithAppKey",
      {
        service: "DataAccessService",
        method: "shareDataWithAppKey",
        section: loggerAppSections.ENCRYPTION,
        details: { resourceId, ownerId, targetUserId },
      },
      "ENCRYPTION.ENCRYPTION_FAILED",
      async () => {
        const db = await getTenantDB();
        const [ownerKeyData] = await db
          .select({
            encryptedMasterKey: this.tableConfig.tableName.encryptedMasterKey,
            thumbnailEncryptedMasterKey: this.tableConfig.tableName.thumbnailEncryptedMasterKey,
          })
          .from(this.tableConfig.tableName)
          .where(
            buildActiveResourceQuery(
              this.tableConfig.tableName,
              this.tableConfig.resourceIdColumn,
              resourceId,
              ownerId,
            ),
          )
          .limit(1);

        if (!ownerKeyData) {
          throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
        }

        const ownerEncryptedMasterKey = ownerKeyData.encryptedMasterKey as Uint8Array;
        const ownerThumbnailEncryptedMasterKey = ownerKeyData.thumbnailEncryptedMasterKey as Uint8Array | null | undefined;

        const contextualDecryptionKey = TextHashing.generateHashFromKeyForEncryption(appKey, encryptionType);

        const dataMasterKey = await useSymmetricDecrypt({
          key: contextualDecryptionKey,
          data: ownerEncryptedMasterKey,
        });

        const reencryptedMasterKey = await useSymmetricEncrypt({
          key: contextualDecryptionKey,
          data: dataMasterKey,
        });

        let reencryptedThumbnailMasterKey: Uint8Array | undefined;
        if (ownerThumbnailEncryptedMasterKey) {
          const thumbnailDataKey = await useSymmetricDecrypt({
            key: contextualDecryptionKey,
            data: ownerThumbnailEncryptedMasterKey,
          });
          reencryptedThumbnailMasterKey = await useSymmetricEncrypt({
            key: contextualDecryptionKey,
            data: thumbnailDataKey,
          });
        }

        await this.storeEncryptedMasterKey({
          resourceId,
          userId: targetUserId,
          encryptedMasterKey: reencryptedMasterKey,
          thumbnailEncryptedMasterKey: reencryptedThumbnailMasterKey,
          encryptionMode: DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
          permissionLevel,
          grantedBy: ownerId,
        });
      },
    );
  }

  async convertSharedToUserControlled(
    resourceId: string,
    userId: string,
    targetUserMasterKey: Uint8Array,
    targetUserEncryptedPrivateKey: Uint8Array,
  ): Promise<void> {
    const db = await getTenantDB();
    await db.transaction(async (tx) => {
      const results = await tx
        .select({
          encryptedMasterKey: this.tableConfig.tableName.encryptedMasterKey,
          thumbnailEncryptedMasterKey: this.tableConfig.tableName.thumbnailEncryptedMasterKey,
        })
        .from(this.tableConfig.tableName)
        .where(
          buildActiveResourceQuery(
            this.tableConfig.tableName,
            this.tableConfig.resourceIdColumn,
            resourceId,
            userId,
          ),
        )
        .limit(1);

      if (results.length === 0 || !results[0].encryptedMasterKey) {
        throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
      }

      const sharedEncryptedDataMasterKey = results[0].encryptedMasterKey as Uint8Array;
      const sharedThumbnailEncryptedMasterKey = results[0].thumbnailEncryptedMasterKey as Uint8Array | null | undefined;

      const decryptedDataMasterKey = await this.keySharingService
        .decryptSharedDataMasterKey(
          sharedEncryptedDataMasterKey,
          targetUserEncryptedPrivateKey,
          targetUserMasterKey,
        );

      const targetUserControlledDataMasterKey = await useSymmetricEncrypt({
        key: targetUserMasterKey,
        data: decryptedDataMasterKey,
      });

      let targetUserControlledThumbnailMasterKey: Uint8Array | null = null;
      if (sharedThumbnailEncryptedMasterKey) {
        try {
          const decryptedThumbnailDataKey = await this.keySharingService
            .decryptSharedDataMasterKey(
              sharedThumbnailEncryptedMasterKey,
              targetUserEncryptedPrivateKey,
              targetUserMasterKey,
            );
          targetUserControlledThumbnailMasterKey = await useSymmetricEncrypt({
            key: targetUserMasterKey,
            data: decryptedThumbnailDataKey,
          });
        } catch (_error) { /* best effort thumbnail re-encryption */ }
      }

      await tx
        .update(this.tableConfig.tableName)
        .set({
          encryptedMasterKey: targetUserControlledDataMasterKey,
          thumbnailEncryptedMasterKey: targetUserControlledThumbnailMasterKey,
          encryptionMode: DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED,
        })
        .where(
          buildActiveResourceQuery(
            this.tableConfig.tableName,
            this.tableConfig.resourceIdColumn,
            resourceId,
            userId,
          ),
        );
    });
  }

  /**
   * Returns the active data key for `resourceId`/`userId`, lazily converting it
   * from ASYMMETRIC (shared) to USER_CONTROLLED on first access when a
   * `userMasterKey` is available.
   *
   * **This method may WRITE** (`convertSharedToUserControlled` issues an UPDATE).
   * It is the explicit, separately-named conversion step that callers opt into
   * after a successful {@link checkPermission}; it is deliberately NOT folded
   * back into the permission check (see backlog item #2). Non-ASYMMETRIC rows
   * are returned unchanged with no write.
   *
   * Returns `null` if no active data key exists for the pair.
   */
  async ensureUserControlledDataKey(
    resourceId: string,
    userId: string,
    userMasterKey: Uint8Array,
  ): Promise<{ encryptedMasterKey: Uint8Array; encryptionMode: string } | null> {
    const db = await getTenantDB();
    const [dataKeyResult] = await db
      .select({
        encryptedMasterKey: this.tableConfig.tableName.encryptedMasterKey,
        encryptionMode: this.tableConfig.tableName.encryptionMode,
      })
      .from(this.tableConfig.tableName)
      .where(
        buildActiveResourceQuery(
          this.tableConfig.tableName,
          this.tableConfig.resourceIdColumn,
          resourceId,
          userId,
        ),
      )
      .limit(1);

    if (!dataKeyResult) {
      return null;
    }

    const dataKey = {
      encryptedMasterKey: dataKeyResult.encryptedMasterKey as Uint8Array,
      encryptionMode: dataKeyResult.encryptionMode as string,
    };

    if (dataKey.encryptionMode !== DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC) {
      return dataKey;
    }

    const encryptedPrivateKey = await this.asymmetricKeysService.getEncryptedPrivateKey(userId);
    if (!encryptedPrivateKey) {
      throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
    }

    await this.convertSharedToUserControlled(resourceId, userId, userMasterKey, encryptedPrivateKey);

    const [updatedKey] = await db
      .select({
        encryptedMasterKey: this.tableConfig.tableName.encryptedMasterKey,
        encryptionMode: this.tableConfig.tableName.encryptionMode,
      })
      .from(this.tableConfig.tableName)
      .where(
        buildActiveResourceQuery(
          this.tableConfig.tableName,
          this.tableConfig.resourceIdColumn,
          resourceId,
          userId,
        ),
      )
      .limit(1);

    return updatedKey
      ? {
        encryptedMasterKey: updatedKey.encryptedMasterKey as Uint8Array,
        encryptionMode: updatedKey.encryptionMode as string,
      }
      : dataKey;
  }

  /**
   * Pure authorization query: reports whether `userId` may perform an operation
   * requiring `requiredLevel` on `resourceId`. This method has **no side
   * effects** — it never writes.
   *
   * Historically `checkPermission` accepted a `userMasterKey` and would, as a
   * side effect, lazily convert an ASYMMETRIC (shared) data key to
   * USER_CONTROLLED on first authenticated access. That mutating behaviour was
   * split out (see item #2 in the remediation backlog): a read-named, read-typed
   * authorization check must not persist key-type changes. Callers that need the
   * lazy conversion now invoke {@link ensureUserControlledDataKey} explicitly
   * after a successful check — see the authenticated download/stream/preview
   * paths in `DocumentDownloadService`.
   */
  async checkPermission(
    resourceId: string,
    userId: string,
    requiredLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<PermissionCheckResult> {
    const db = await getTenantDB();
    const userAccess = await db
      .select({
        permissionLevel: this.tableConfig.tableName.permissionLevel,
      })
      .from(this.tableConfig.tableName)
      .where(
        buildActiveResourceQuery(
          this.tableConfig.tableName,
          this.tableConfig.resourceIdColumn,
          resourceId,
          userId,
        ),
      )
      .limit(1);

    if (userAccess.length === 0) {
      return { hasPermission: false, errorMessage: "User does not have access to this resource" };
    }

    const currentLevel = userAccess[0].permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL;
    const hasRequiredPermission = currentLevel === DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN ||
      permissionLevelMeets(currentLevel, requiredLevel);

    return { hasPermission: hasRequiredPermission, currentLevel };
  }

  static getEncryptionKeyForDataMasterKey(
    c: HonoContext,
    resourceId?: string,
    tableConfig?: IEncryptionTableConfig,
  ): Promise<{ key: Uint8Array; type: "app" | "user" }> {
    return traced("DataAccessService.getEncryptionKeyForDataMasterKey", "service", async (span) => {
      const userId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails);
      const apiKey = c.get(AUTH_HEADER_NAMING.internalUsageAuthApiKeyDetails);
      span.attributes["user.id"] = userId;
      span.attributes["has_resource_id"] = !!resourceId;

      // Acquire the tenant DB in its own span so cold-connect / migration cost
      // (historically the dominant latency on the first request to a cold
      // tenant) is attributable in traces instead of hiding inside this span.
      const db = await traced(
        "DataAccessService.acquireTenantDB",
        "db.query",
        () => getTenantDB(),
      );

      if (resourceId && tableConfig) {
        const [dataKeyResult] = await db
          .select({ encryptionMode: tableConfig.tableName.encryptionMode })
          .from(tableConfig.tableName)
          .where(
            and(
              eq(tableConfig.tableName[tableConfig.resourceIdColumn], resourceId),
              eq(tableConfig.tableName.userId, userId),
              eq(tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        if (dataKeyResult?.encryptionMode === DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED) {
          span.attributes["encryption.key_type"] = "app";
          return {
            key: TextTransformations.base64ToBuffer(envConfig.storage.encryptionKey!),
            type: "app" as const,
          };
        }
      }

      const globalDb = getGlobalDB();

      // Resolve the tenant id once. It is already present on the auth context
      // (set by the auth middleware from the validated JWT/API key), so prefer
      // that and avoid a redundant global-DB round-trip on the hot path. Fall
      // back to the global users lookup only if the context value is missing.
      let environmentId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserEnvironmentIdDetails) as
        | string
        | undefined;

      if (!environmentId) {
        const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId))
          .limit(1);

        if (!userRow) throwHttpError("USER.NOT_FOUND");
        environmentId = userRow.environmentId;
      }

      span.attributes["encryption.env_id_source"] = environmentId ? "context" : "global_lookup";

      const tenantDb = await getTenantDB(environmentId);
      const [encryption] = await tenantDb.select({ isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      span.attributes["encryption.enhanced_enabled"] = !!encryption?.isEnhancedEncryptionEnabled;

      if (!encryption?.isEnhancedEncryptionEnabled) {
        span.attributes["encryption.key_type"] = "app";
        return {
          key: TextTransformations.base64ToBuffer(envConfig.storage.encryptionKey!),
          type: "app" as const,
        };
      }

      // Enhanced (user-controlled) encryption is enabled: the user master key is
      // derived from session data, so we must pull the JWT / access token here.
      // This deliberately happens only inside this branch — app-controlled
      // resources above never need the session token.
      const accessToken = useGetCookie(c, AUTH_HEADER_NAMING.access);

      if (accessToken) {
        span.attributes["encryption.key_source"] = "access_token";
        const sessionKey = c.get(AUTH_HEADER_NAMING.internalSessionKey) as string | undefined;

        // Reuse the session the auth middleware already validated (threaded via
        // context) so we skip the second validateJWTSession / EdDSA verify. Falls
        // back to full validation when not threaded (e.g. non-request callers).
        const preloadedSessionData = c.get(AUTH_HEADER_NAMING.internalValidatedSession) as
          | ITokensSessionData
          | undefined;

        // Thread the already-resolved environmentId through so the PRF path does
        // not repeat the global users lookup (resolveEnvironmentId).
        const userMasterKey = await EncryptionSystemUserService
          .getUserMasterKeyForDataEncryptionWithPRF(
            userId,
            accessToken,
            undefined,
            undefined,
            sessionKey,
            environmentId,
            preloadedSessionData,
          );
        span.attributes["encryption.key_type"] = "user";
        return { key: userMasterKey, type: "user" as const };
      }

      if (apiKey) {
        span.attributes["encryption.key_source"] = "api_key";
        const keyHash = tokenHashString(apiKey);
        const [apiKeyData] = await tenantDb.select({ apiKeyDerivedKey: tenantTables.apiKeys.apiKeyDerivedKey })
          .from(tenantTables.apiKeys)
          .where(and(
            eq(tenantTables.apiKeys.keyHash, keyHash),
            eq(tenantTables.apiKeys.userId, userId),
            eq(tenantTables.apiKeys.isActive, true),
          )).limit(1);

        if (!apiKeyData) throwHttpError("ENCRYPTION.KEY_NOT_FOUND");

        const apiKeyDerivedKey = await EncryptionSystemUserService.generatePasswordDerivedKey(apiKey, userId);
        const decryptedMasterKey = await useSymmetricDecrypt({
          key: apiKeyDerivedKey,
          data: apiKeyData.apiKeyDerivedKey as Uint8Array,
        });
        span.attributes["encryption.key_type"] = "user";
        return { key: decryptedMasterKey, type: "user" as const };
      }

      throwHttpError("AUTH.UNAUTHORIZED");
    });
  }

  private async storeEncryptedMasterKey(params: StoreEncryptedMasterKeyParams): Promise<void> {
    const db = await getTenantDB();
    await db
      .insert(this.tableConfig.tableName)
      .values({
        id: generateIdRandom(),
        [this.tableConfig.resourceIdColumn]: params.resourceId,
        userId: params.userId,
        encryptedMasterKey: params.encryptedMasterKey,
        thumbnailEncryptedMasterKey: params.thumbnailEncryptedMasterKey ?? null,
        encryptionMode: params.encryptionMode,
        permissionLevel: params.permissionLevel,
        isActive: true,
        keyVersion: 1,
        grantedAt: getTimeNowForStorage(),
        grantedBy: params.grantedBy,
        accessCount: 0,
      });
  }

  async revokeSharedAccessForRecipientsWithoutKeys(grantedByUserId: string) {
    const db = await getTenantDB();
    const sharedKeys = await db
      .select({
        id: this.tableConfig.tableName.id,
        resourceId: this.tableConfig.tableName[this.tableConfig.resourceIdColumn],
        userId: this.tableConfig.tableName.userId,
      })
      .from(this.tableConfig.tableName)
      .where(and(
        eq(this.tableConfig.tableName.grantedBy, grantedByUserId),
        eq(this.tableConfig.tableName.isActive, true),
      ));

    if (sharedKeys.length === 0) return { revokedCount: 0, revokedResources: [] };

    const recipientUserIds = [...new Set(sharedKeys.map((k) => k.userId).filter(Boolean))] as string[];
    const recipientHasKeyPair = await this.asymmetricKeysService.batchHasKeyPair(recipientUserIds);
    const recipientsWithoutKeys = new Set(recipientUserIds.filter((id) => !recipientHasKeyPair.get(id)));

    const keysToRevoke = sharedKeys.filter((key) => key.userId && recipientsWithoutKeys.has(key.userId));
    const now = Math.floor(Date.now() / 1000);

    if (keysToRevoke.length > 0) {
      await db.update(this.tableConfig.tableName)
        .set({ isActive: false, revokedAt: now, updatedAt: now })
        .where(inArray(this.tableConfig.tableName.id, keysToRevoke.map((k) => k.id)));
    }

    return {
      revokedCount: keysToRevoke.length,
      revokedResources: keysToRevoke.map((k) => ({ resourceId: k.resourceId as string, recipientUserId: k.userId! })),
    };
  }
}
