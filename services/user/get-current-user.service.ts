/**
 * @file services/user/get-current-user.service.ts
 * @description Service to get current user with detailed permission information
 */

import { and, eq, inArray } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import type { ICurrentUserResponse, IPermissionDetail } from "@models/environment-config-user/index.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

/**
 * Get current user with detailed permission information
 */
export async function getCurrentUserService(
  userId: string,
  environmentId: string,
): Promise<ICurrentUserResponse> {
  return await tracedWithServiceErrorHandling(
    "GetCurrentUser.getCurrentUser",
    {
      service: "GetCurrentUserService",
      method: "getCurrentUser",
      section: loggerAppSections.USER,
      details: { userId, environmentId },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      span.attributes["user_id"] = userId;
      span.attributes["environment_id"] = environmentId;

      const globalDb = getGlobalDB();
      const tenantDb = await getTenantDB(environmentId);

      // 1. Fetch user from Global DB
      const [userData] = await globalDb
        .select({
          id: globalTables.users.id,
          username: globalTables.users.username,
          isActive: globalTables.users.isActive,
          isSuperAdmin: globalTables.users.isSuperAdmin,
          isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
          createdAt: globalTables.users.createdAt,
          updatedAt: globalTables.users.updatedAt,
          lastLoginAt: globalTables.users.lastLoginAt,
          password: globalTables.users.password,
        })
        .from(globalTables.users)
        .where(
          and(
            eq(globalTables.users.id, userId),
            eq(globalTables.users.environmentId, environmentId),
          ),
        )
        .limit(1);

      if (!userData) {
        throwHttpError("USER.NOT_FOUND");
      }

      // 1b. Fetch user profile from Tenant DB (name, email, language preference)
      const [userProfile] = await tenantDb
        .select({
          firstName: tenantTables.userProfiles.firstName,
          lastName: tenantTables.userProfiles.lastName,
          email: tenantTables.userProfiles.email,
          isAdmin: tenantTables.userProfiles.isAdmin,
          language: tenantTables.userProfiles.language,
        })
        .from(tenantTables.userProfiles)
        .where(eq(tenantTables.userProfiles.userId, userId))
        .limit(1);

      const firstName = userProfile?.firstName ?? "";
      const lastName = userProfile?.lastName ?? "";
      const email = userProfile?.email || null;
      const language = userProfile?.language ?? "en";

      // 2. Check if user belongs to a permission group (Tenant DB)
      const groupMembership = await tenantDb
        .select({
          groupId: tenantTables.userPermissionGroups.groupId,
          groupName: tenantTables.permissionGroups.name,
        })
        .from(tenantTables.userPermissionGroups)
        .innerJoin(
          tenantTables.permissionGroups,
          eq(tenantTables.userPermissionGroups.groupId, tenantTables.permissionGroups.id),
        )
        .where(eq(tenantTables.userPermissionGroups.userId, userId))
        .limit(1);

      const groupInfo = groupMembership[0];
      const isInGroup = groupInfo !== undefined;
      const permissionGroupId = groupInfo?.groupId ?? null;
      const permissionGroupName = groupInfo?.groupName ?? null;
      const permissionSourceType: "group" | "direct" = isInGroup ? "group" : "direct";

      // 3. Fetch permissions (Tenant DB)
      const permissions: IPermissionDetail[] = [];

      if (isInGroup && permissionGroupId) {
        const groupPerms = await tenantDb
          .select({ name: tenantTables.permissions.name })
          .from(tenantTables.permissionGroupPermissions)
          .innerJoin(
            tenantTables.permissions,
            eq(tenantTables.permissionGroupPermissions.permissionId, tenantTables.permissions.id),
          )
          .where(eq(tenantTables.permissionGroupPermissions.groupId, permissionGroupId));

        permissions.push(...groupPerms.map((p) => ({ name: p.name, source: "group" as const })));
      } else {
        const directPerms = await tenantDb
          .select({ name: tenantTables.permissions.name })
          .from(tenantTables.userPermissions)
          .innerJoin(
            tenantTables.permissions,
            eq(tenantTables.userPermissions.permissionId, tenantTables.permissions.id),
          )
          .where(eq(tenantTables.userPermissions.userId, userId));

        permissions.push(...directPerms.map((p) => ({ name: p.name, source: "direct" as const })));
      }

      // 4. Check if user has passkeys (Global DB)
      const passkeyResult = await globalDb
        .select({
          id: globalTables.userPasskeys.id,
          displayName: globalTables.userPasskeys.displayName,
          createdAt: globalTables.userPasskeys.createdAt,
        })
        .from(globalTables.userPasskeys)
        .where(eq(globalTables.userPasskeys.userId, userId));

      const hasPasskey = passkeyResult.length > 0;
      const passkeyIds = passkeyResult.map((p) => p.id);

      // 5. Check encryption status (Tenant DB)
      const [userEncryption] = await tenantDb
        .select({
          isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
        })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      const isEnhancedEncryptionEnabled = userEncryption?.isEnhancedEncryptionEnabled ?? false;
      const hasPassword = userData.password !== null;

      // Check which passkeys have PRF configured (Global DB)
      let prfConfiguredIds: string[] = [];
      if (passkeyIds.length > 0) {
        const prfKeys = await globalDb
          .select({
            credentialId: globalTables.passkeyPRFKeys.credentialId,
          })
          .from(globalTables.passkeyPRFKeys)
          .where(inArray(globalTables.passkeyPRFKeys.credentialId, passkeyIds));

        prfConfiguredIds = prfKeys.map((k) => k.credentialId);
      }

      const hasPRF = prfConfiguredIds.length > 0;

      const passkeysNeedingPRF = passkeyResult
        .filter((p) => !prfConfiguredIds.includes(p.id))
        .map((p) => ({
          id: p.id,
          displayName: p.displayName,
          createdAt: p.createdAt ?? 0,
        }));

      let recommendedAction: "setup_prf" | "enable_encryption" | "none";
      if (isEnhancedEncryptionEnabled) {
        recommendedAction = "none";
      } else if (hasPassword || hasPRF) {
        recommendedAction = "enable_encryption";
      } else if (passkeysNeedingPRF.length > 0) {
        recommendedAction = "setup_prf";
      } else {
        recommendedAction = "none";
      }

      // 6. Fetch environment feature flags (Global DB)
      const [envFeatures] = await globalDb
        .select({
          featureDocuments: globalTables.environments.featureDocuments,
          featureEncryption: globalTables.environments.featureEncryption,
          featurePublicSharing: globalTables.environments.featurePublicSharing,
          featureNotes: globalTables.environments.featureNotes,
          featureKnowledgeBase: globalTables.environments.featureKnowledgeBase,
        })
        .from(globalTables.environments)
        .where(eq(globalTables.environments.id, environmentId))
        .limit(1);

      const FEATURE_MAP: Array<{ column: keyof NonNullable<typeof envFeatures>; name: string }> = [
        { column: "featureDocuments", name: "documents" },
        { column: "featureEncryption", name: "encryption" },
        { column: "featurePublicSharing", name: "publicSharing" },
        { column: "featureNotes", name: "notes" },
        { column: "featureKnowledgeBase", name: "knowledgeBase" },
      ];

      const features: string[] = envFeatures ? FEATURE_MAP.filter((f) => envFeatures[f.column]).map((f) => f.name) : [];

      return {
        id: userData.id,
        firstName,
        lastName,
        email,
        username: userData.username,
        language,
        isActive: userData.isActive,
        isSignedUp: true, // Migrated from identities
        isAdmin: userProfile?.isAdmin ?? false,
        isSuperAdmin: userData.isSuperAdmin,
        isTwoFactorEnabled: userData.isTwoFactorEnabled,
        createdAt: userData.createdAt ?? 0,
        updatedAt: userData.updatedAt ?? 0,
        lastLoginAt: userData.lastLoginAt ?? 0,
        permissionGroupId,
        permissionGroup: permissionGroupId && permissionGroupName ? { id: permissionGroupId, name: permissionGroupName } : null,
        permissionSourceType,
        permissions,
        hasPasskey,
        encryption: {
          isEnhancedEncryptionEnabled,
          hasPassword,
          hasPasskeys: hasPasskey,
          hasPRF,
          passkeysNeedingPRF,
          recommendedAction,
        },
        features,
      };
    },
  );
}
