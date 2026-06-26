/**
 * @file services/user/api-keys/create-key.service.ts
 * @description Create Key service (user api keys)
 */
import { loggerAppSections, LoggerLevels, useLogger, useLogSecurityEvent } from "@logger/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { Buffer, count, eq, inArray, randomBytes } from "@deps";
import { getPermissionGroup, hasPermission, permissionsCacheClearApiKeyPermissions } from "@services/permissions/index.ts";
import { IUserApiKeyCreateRequest, IUserApiKeyCreateResponse } from "@models/users/index.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { getSessionRateLimiter } from "@services/session/index.ts";
import { useValidateArrayAndLength, useValidateDomainBeforeInsert, useValidateIpBeforeInsert } from "@utils/security-check.ts";
import { convertToStorageFormat, detectTimestampFormat, validateTimestamp } from "@utils/shared/index.ts";
import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { tokenHashString } from "@services/token/index.ts";
import { EncryptionSystemUserService, useSymmetricEncrypt } from "@services/encryption/index.ts";
import { envConfig } from "@config/env.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getUserEnhancedEncryptionSettingsService } from "../index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";

// Constants for security limits
const MAX_API_KEYS_PER_USER = 10;

/**
 * Chunk size for batch database operations.
 * Prevents memory pressure and query timeout issues with large batches.
 */
const BATCH_CHUNK_SIZE = 50;

export class UserAPIKeysCreateService {
  /**
   * @param userId - The ID of the user creating the API key
   * @param environmentId - The ID of the environment the API key is being created for
   * @param options - The options for creating the API key
   * @returns The result of the API key creation
   */
  async createApiKey(
    userId: string,
    isAdmin: boolean,
    environmentId: string,
    accessToken: string,
    options: IUserApiKeyCreateRequest,
  ): Promise<IUserApiKeyCreateResponse> {
    return await tracedWithServiceErrorHandling(
      "UserAPIKeysCreateService.createApiKey",
      {
        service: "UserAPIKeysCreateService",
        method: "createApiKey",
        section: loggerAppSections.USER,
        details: { userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["key_name"] = options.name;
        span.attributes["has_expiration"] = !!options.expiresAt;

        // Validation checks (can throw HTTP exceptions)
        const canCreateApiKeys = await hasPermission(
          isAdmin,
          userId,
          "apiKey.create",
        );

        if (!canCreateApiKeys) {
          span.attributes["failure_reason"] = "no_permission";
          throwHttpError("USER_API_KEY.NO_PERMISSION");
        }

        const rateLimitResult = await getSessionRateLimiter().checkRateLimit(
          userId,
          "API_KEY_CREATION",
        );

        if (!rateLimitResult.allowed) {
          await this.logSecurityEvent("API_KEY_CREATION_RATE_LIMITED", {
            userId: userId,
            name: options.name,
            remainingAttempts: rateLimitResult.remainingAttempts,
            resetTime: rateLimitResult.resetTime,
          });
          throwHttpError("RATE_LIMIT.EXCEEDED");
        }

        // Validate that API key has either permissions OR a permission group, not both
        if (
          options.permissions && options.permissions.length > 0 &&
          options.permissionGroup
        ) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        // Validate expiration date if provided
        if (options.expiresAt !== undefined) {
          if (
            typeof options.expiresAt !== "number" ||
            !isFinite(options.expiresAt)
          ) {
            throwHttpError("COMMON.INVALID_INPUT");
          }

          // Detect timestamp format and validate accordingly
          const timestampFormat = detectTimestampFormat(options.expiresAt);
          const isValidTimestamp = validateTimestamp(
            options.expiresAt,
            timestampFormat,
          );

          if (!isValidTimestamp) {
            throwHttpError("COMMON.INVALID_INPUT");
          }
        }

        const existingKeysCount = await (await getTenantDB())
          .select({ count: count() })
          .from(tenantTables.apiKeys)
          .where(eq(tenantTables.apiKeys.userId, userId));

        if (existingKeysCount[0].count >= MAX_API_KEYS_PER_USER) {
          throwHttpError("USER_API_KEY.MAX_NUMBER_OF_KEYS");
        }

        // Validate optional arrays
        const validatedPermissions = options.permissions
          ? useValidateArrayAndLength<string>(
            options.permissions,
            50,
          )
          : [];

        const validatedIpRestrictions = options.ipRestrictions
          ? useValidateArrayAndLength<string>(
            options.ipRestrictions,
            20,
          )
          : [];

        const validatedDomainRestrictions = options.domainRestrictions
          ? useValidateArrayAndLength<string>(
            options.domainRestrictions,
            20,
          )
          : [];

        if (validatedIpRestrictions.length > 0) {
          const res = useValidateIpBeforeInsert(validatedIpRestrictions);
          if (!res.isSuccess) {
            throwHttpError("USER_API_KEY.IP_RESTRICTION_FAILED");
          }
        }

        // Validate domain restrictions if provided
        if (validatedDomainRestrictions.length > 0) {
          const res = useValidateDomainBeforeInsert(
            validatedDomainRestrictions,
          );
          if (!res.isSuccess) {
            throwHttpError("USER_API_KEY.DOMAIN_RESTRICTION_FAILED");
          }
        }

        // Generate API key using existing function
        const apiKey = randomBytes(32);
        const apiKeyString = envConfig.auth.apiKeyPrefix + "-" +
          Buffer.from(apiKey).toString("hex");
        const keyHash = tokenHashString(apiKeyString);
        const keyEndingIn = apiKeyString.slice(-6); // Last 6 characters for user identification

        // Get permission IDs for the provided permissions
        const permissionIds: string[] = [];
        if (validatedPermissions.length > 0) {
          permissionIds.push(
            ...await this.getPermissionIds(validatedPermissions),
          );
        }

        // Get permission group ID if provided
        let permissionGroupId: string | undefined;
        if (options.permissionGroup) {
          permissionGroupId = await this.getPermissionGroupId(
            options.permissionGroup,
            environmentId,
          );
        }

        let encryptedApiKeyDerivedKey: Uint8Array | null = null;
        if (
          await getUserEnhancedEncryptionSettingsService()
            .hasEnhancedEncryptionEnabled(userId)
        ) {
          const apiKeyDerivedKey = await EncryptionSystemUserService
            .generatePasswordDerivedKey(apiKeyString, userId);
          const userMasterKey = await EncryptionSystemUserService
            .getUserMasterKeyForDataEncryptionWithPRF(userId, accessToken);

          encryptedApiKeyDerivedKey = await useSymmetricEncrypt({
            key: apiKeyDerivedKey,
            data: userMasterKey,
          });
        }

        // Store API key in database with transaction, wrapped in retry for ID collision
        const apiKeyId = await databaseCreateWithRetry(async (newId) => {
          await (await getTenantDB()).transaction(async (tx) => {
            await tx.insert(tenantTables.apiKeys).values({
              id: newId,
              name: options.name,
              keyHash: keyHash,
              apiKeyDerivedKey: encryptedApiKeyDerivedKey,
              keyEndingIn: keyEndingIn,
              userId: userId,
              expiresAt: options.expiresAt ? convertToStorageFormat(options.expiresAt) : null,
              ipRestrictions: validatedIpRestrictions.length > 0 ? validatedIpRestrictions : null,
              domainRestrictions: validatedDomainRestrictions.length > 0 ? validatedDomainRestrictions : null,
              isActive: true,
              lastUsedAt: null,
            });

            // Insert direct permission assignments with chunking
            if (permissionIds.length > 0) {
              const permissionInserts = permissionIds.map((permissionId) => ({
                apiKeyId: newId,
                permissionId: permissionId,
              }));

              // Process in chunks to prevent memory pressure with large permission sets
              for (let i = 0; i < permissionInserts.length; i += BATCH_CHUNK_SIZE) {
                const chunk = permissionInserts.slice(i, i + BATCH_CHUNK_SIZE);
                await tx.insert(tenantTables.apiKeyPermissions).values(chunk);
              }
            }

            // Insert permission group assignment
            if (permissionGroupId) {
              await tx.insert(tenantTables.apiKeyPermissionGroups).values({
                apiKeyId: newId,
                groupId: permissionGroupId,
              });
            }
          }).catch((err) => {
            useLogger(LoggerLevels.error, {
              message: "Unexpected error creating API key",
              section: loggerAppSections.USER,
              messageKey: "user_api_key.create.unexpected_error",
              details: { userId, name: options.name, error: err },
            });
          });
          return newId;
        }, generateIdRandomWithTimestamp);

        const allPermissions = await this.getAllApiKeyPermissions(apiKeyId);

        await permissionsCacheClearApiKeyPermissions(apiKeyId);

        span.attributes["success"] = true;
        span.attributes["permissions_count"] = allPermissions.length;

        return {
          key: apiKeyString,
          name: options.name,
          id: apiKeyId,
          keyEndingIn,
          expiresAt: options.expiresAt,
          permissions: allPermissions,
        };
      },
    );
  }

  /**
   * Gets all permissions for an API key (direct + from group)
   * @private
   */
  private async getAllApiKeyPermissions(
    apiKey: string,
  ): Promise<string[]> {
    try {
      // Get direct permissions
      const directPermissions = await (await getTenantDB())
        .select({ name: tenantTables.permissions.name })
        .from(tenantTables.apiKeyPermissions)
        .innerJoin(
          tenantTables.permissions,
          eq(tenantTables.apiKeyPermissions.permissionId, tenantTables.permissions.id),
        )
        .where(eq(tenantTables.apiKeyPermissions.apiKeyId, apiKey));

      // Get permissions from group using the permission helper service
      const groupAssignments = await (await getTenantDB())
        .select({ group_id: tenantTables.apiKeyPermissionGroups.groupId })
        .from(tenantTables.apiKeyPermissionGroups)
        .where(eq(tenantTables.apiKeyPermissionGroups.apiKeyId, apiKey));

      const groupPermissionsPromises = groupAssignments.map(
        async (groupAssignment) => {
          const group = await getPermissionGroup(groupAssignment.group_id);
          return group?.permissions ?? [];
        },
      );

      const groupPermissionsArrays = await Promise.all(
        groupPermissionsPromises,
      );
      const groupPermissions = groupPermissionsArrays.flat();

      // Combine and deduplicate permissions
      const allPermissionNames = [
        ...directPermissions.map((p) => p.name),
        ...groupPermissions,
      ];

      return [...new Set(allPermissionNames)]; // Remove duplicates
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      await this.logSecurityEvent("GET_API_KEY_PERMISSIONS_FAILED", {
        apiKey,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      useLogger(LoggerLevels.error, {
        message: "Unexpected error getting API key permissions",
        messageKey: "user_api_key.get_permissions.unexpected_error",
        section: loggerAppSections.USER,
        details: { apiKey },
        raw: error,
      });

      return [];
    }
  }

  /**
   * Gets permission IDs from permission names using parameterized queries
   * @private
   */
  private async getPermissionIds(
    permissionNames: string[],
  ): Promise<string[]> {
    if (permissionNames.length === 0) return [];

    // Validate permission names format
    for (const name of permissionNames) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
        throwHttpError("COMMON.INVALID_INPUT");
      }
    }

    try {
      // Use parameterized query with inArray to prevent SQL injection
      const results = await (await getTenantDB())
        .select({ id: tenantTables.permissions.id, name: tenantTables.permissions.name })
        .from(tenantTables.permissions)
        .where(inArray(tenantTables.permissions.name, permissionNames));

      // Check if all requested permissions exist
      const foundNames = results.map((r) => r.name);
      const missingPermissions = permissionNames.filter((name) => !foundNames.includes(name));

      if (missingPermissions.length > 0) {
        await this.logSecurityEvent("PERMISSION_VALIDATION_FAILED", {
          permissionNames,
          missingPermissions,
        });
        throwHttpError("COMMON.INVALID_INPUT");
      }

      return results.map((r) => r.id);
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      await this.logSecurityEvent("PERMISSION_VALIDATION_FAILED", {
        permissionNames,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // caller owns logging
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  /**
   * Gets permission group ID from group name using parameterized queries
   * @private
   */
  private async getPermissionGroupId(
    groupId: string,
    _environmentId: string,
  ): Promise<string> {
    try {
      const results = await (await getTenantDB())
        .select({ id: tenantTables.permissionGroups.id })
        .from(tenantTables.permissionGroups)
        .where(eq(tenantTables.permissionGroups.id, groupId))
        .limit(1);

      if (results.length === 0) {
        throwHttpError("COMMON.INVALID_INPUT");
      }

      return results[0].id;
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      // caller owns logging
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  private async logSecurityEvent(
    eventType: string,
    details: Record<string, unknown>,
    component: string = "SessionService",
  ): Promise<void> {
    try {
      const severity = eventType.includes("FAILED") || eventType.includes("RATE_LIMITED") ? "high" : "medium";

      await useLogSecurityEvent(
        LoggerLevels.warn,
        eventType,
        severity,
        loggerAppSections.SESSION,
        component,
        details,
      );
    } catch (error) {
      console.error(`Failed to log security event ${eventType}:`, error);
    }
  }
}
