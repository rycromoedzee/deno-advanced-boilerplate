/**
 * @file services/super-admin/environment-overview.service.ts
 * @description Environment Overview service (super admin)
 */
import { and, asc, eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { envConfig } from "@config/env.ts";
import { useSymmetricDecrypt } from "@services/encryption/encryption.helper.ts";
import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";
import type { IEnvironmentOverviewResponse } from "@models/super-admin/index.ts";

export class EnvironmentOverviewService {
  async getEnvironmentOverview(environmentId: string): Promise<IEnvironmentOverviewResponse> {
    return await tracedWithServiceErrorHandling(
      "EnvironmentOverviewService.getEnvironmentOverview",
      {
        service: "EnvironmentOverviewService",
        method: "getEnvironmentOverview",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select()
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        const tenantDb = await getTenantDB(environmentId);
        const [tenantAdmin] = await tenantDb
          .select({
            id: tenantTables.userProfiles.userId,
          })
          .from(tenantTables.userProfiles)
          .where(eq(tenantTables.userProfiles.isAdmin, true))
          .orderBy(asc(tenantTables.userProfiles.createdAt))
          .limit(1);

        const [adminUser] = tenantAdmin
          ? await globalDb
            .select({
              id: globalTables.users.id,
              isActive: globalTables.users.isActive,
              lastLoginAt: globalTables.users.lastLoginAt,
            })
            .from(globalTables.users)
            .where(
              and(
                eq(globalTables.users.id, tenantAdmin.id),
                eq(globalTables.users.environmentId, environmentId),
              ),
            )
            .limit(1)
          : [];

        let adminProfile: { firstName: string; lastName: string; email: string } | null = null;
        if (adminUser) {
          const [profile] = await tenantDb
            .select({
              firstName: tenantTables.userProfiles.firstName,
              lastName: tenantTables.userProfiles.lastName,
              email: tenantTables.userProfiles.email,
            })
            .from(tenantTables.userProfiles)
            .where(eq(tenantTables.userProfiles.userId, adminUser.id))
            .limit(1);
          adminProfile = profile ?? null;
        }

        const [quotas] = await globalDb
          .select()
          .from(globalTables.environmentQuotas)
          .where(eq(globalTables.environmentQuotas.id, environmentId))
          .limit(1);

        const [dbConfig] = await globalDb
          .select()
          .from(globalTables.environmentSqliteRegistry)
          .where(eq(globalTables.environmentSqliteRegistry.id, environmentId))
          .limit(1);

        let database = null;
        if (dbConfig) {
          const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
            envConfig.auth.generalEncryptionKey!,
            HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
          );
          const decryptedUrl = new TextDecoder().decode(
            await useSymmetricDecrypt({ key: encryptionKey, data: dbConfig.dbUrlEncrypted }),
          );
          database = {
            id: dbConfig.id,
            url: decryptedUrl,
            token: "***",
            status: "connected" as const,
            createdAt: dbConfig.createdAt,
          };
        }

        return {
          general: {
            id: environment.id,
            name: environment.name,
            description: environment.description,
            customSubdomain: environment.customSubdomain,
            customDomain: environment.customDomain,
            status: environment.status as "active" | "inactive" | "provisioning" | "suspended" | "deactivated",
            timezone: environment.timezone,
            defaultLanguage: environment.defaultLanguage,
            internalNotes: environment.internalNotes,
            createdAt: environment.createdAt,
            updatedAt: environment.updatedAt,
          },
          primaryAdmin: adminUser && adminProfile
            ? {
              id: adminUser.id,
              firstName: adminProfile.firstName,
              lastName: adminProfile.lastName,
              email: adminProfile.email,
              isActive: adminUser.isActive,
              lastLoginAt: adminUser.lastLoginAt,
            }
            : null,
          features: {
            documents: environment.featureDocuments,
            encryption: environment.featureEncryption,
            publicSharing: environment.featurePublicSharing,
            notes: environment.featureNotes,
            knowledgeBase: environment.featureKnowledgeBase,
          },
          quotas: {
            maxUsers: quotas?.maxUsers ?? null,
            maxStorageKb: quotas?.maxStorageKb ?? null,
            maxFileSizeKb: quotas?.maxFileSizeKb ?? null,
            currentStorageKb: quotas?.currentStorageKb ?? 0,
          },
          database,
        };
      },
    );
  }
}
