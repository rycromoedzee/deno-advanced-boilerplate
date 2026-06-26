/**
 * @file services/super-admin/environment.service.ts
 * @description Environment service (super admin)
 */
import { and, asc, createNodeClient, createWebClient, desc, drizzle, eq, inArray, migrate } from "@deps";
import { invalidateEnvironmentCache } from "@middleware/feature-guard.middleware.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { evictTenantDB, getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { generateIdForEnvironment } from "@utils/database/id-generation/index.ts";
import { generateIdForUser } from "@utils/database/id-generation/index.ts";
import { envConfig } from "@config/env.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";
import { getPasswordResetService } from "@services/auth/index.ts";
import { getEmailSenderService } from "@services/mailer/index.ts";
import { getStorage } from "@services/storage/index.ts";
import { buildEnvironmentPurgeRow } from "@services/object-backup/tombstone.ts";
import { fireAndForgetOperation } from "@utils/shared/index.ts";
import * as tenantSchema from "@db/schema/tenant/index.ts";
import type {
  IAdminUserCreateRequest,
  IDatabaseCreateRequestCombined,
  IEnvironmentCreateRequest,
  IEnvironmentDetailResponse,
  IEnvironmentUpdateRequest,
} from "@models/super-admin/index.ts";
import { EMAIL_SIGN_UP_FEATURES } from "@constants/mail.ts";

const TENANT_MIGRATIONS_DIR = "./db/tenant-migrations";

function createLibSQLClient(config: { url: string; authToken?: string }) {
  if (config.url.startsWith("file:")) {
    return createNodeClient(config);
  }
  return createWebClient(config);
}

export class SuperAdminEnvironmentService {
  async listEnvironments() {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.listEnvironments",
      {
        service: "SuperAdminEnvironmentService",
        method: "listEnvironments",
        section: loggerAppSections.INTERNAL,
        details: {},
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (_span) => {
        const globalDb = getGlobalDB();
        const environments = await globalDb
          .select({
            id: globalTables.environments.id,
            name: globalTables.environments.name,
            description: globalTables.environments.description,
            status: globalTables.environments.status,
            createdAt: globalTables.environments.createdAt,
            updatedAt: globalTables.environments.updatedAt,
          })
          .from(globalTables.environments)
          .orderBy(desc(globalTables.environments.createdAt));

        return { data: environments };
      },
    );
  }

  async getEnvironmentById(environmentId: string): Promise<IEnvironmentDetailResponse> {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.getEnvironmentById",
      {
        service: "SuperAdminEnvironmentService",
        method: "getEnvironmentById",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;
        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select({
            id: globalTables.environments.id,
            name: globalTables.environments.name,
            description: globalTables.environments.description,
            status: globalTables.environments.status,
            createdAt: globalTables.environments.createdAt,
            updatedAt: globalTables.environments.updatedAt,
          })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

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
            environmentId: environmentId,
            url: decryptedUrl,
            token: "***",
            status: "connected" as const,
            createdAt: dbConfig.createdAt,
          };
        }

        const tenantDb = await getTenantDB(environmentId);
        const adminCandidates = await tenantDb
          .select({
            id: tenantTables.userProfiles.userId,
            createdAt: tenantTables.userProfiles.createdAt,
          })
          .from(tenantTables.userProfiles)
          .where(eq(tenantTables.userProfiles.isAdmin, true))
          .orderBy(asc(tenantTables.userProfiles.createdAt));

        const activeAdminIds = adminCandidates.map((candidate) => candidate.id);
        const activeAdminUsers = activeAdminIds.length > 0
          ? await globalDb
            .select({
              id: globalTables.users.id,
              username: globalTables.users.username,
              createdAt: globalTables.users.createdAt,
            })
            .from(globalTables.users)
            .where(
              and(
                inArray(globalTables.users.id, activeAdminIds),
                eq(globalTables.users.environmentId, environmentId),
                eq(globalTables.users.isActive, true),
              ),
            )
          : [];

        const activeAdminMap = new Map(activeAdminUsers.map((user) => [user.id, user]));
        const adminUser = adminCandidates
          .map((candidate) => activeAdminMap.get(candidate.id))
          .find((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);

        let adminUserResult = null;
        if (adminUser) {
          const [profile] = await tenantDb
            .select({
              language: tenantTables.userProfiles.language,
              firstName: tenantTables.userProfiles.firstName,
              lastName: tenantTables.userProfiles.lastName,
              email: tenantTables.userProfiles.email,
            })
            .from(tenantTables.userProfiles)
            .where(eq(tenantTables.userProfiles.userId, adminUser.id))
            .limit(1);

          adminUserResult = {
            id: adminUser.id,
            environmentId: environmentId,
            username: adminUser.username ?? "",
            email: profile?.email ?? "",
            firstName: profile?.firstName ?? "",
            lastName: profile?.lastName ?? "",
            lang: profile?.language ?? "en",
            createdAt: adminUser.createdAt ?? 0,
          };
        }

        return {
          id: environment.id,
          name: environment.name,
          description: environment.description,
          status: environment.status as "active" | "inactive" | "provisioning" | "suspended" | "deactivated",
          createdAt: environment.createdAt,
          updatedAt: environment.updatedAt,
          databaseId: database?.id ?? null,
          databaseUrl: database?.url ?? null,
          databaseToken: database?.token ?? null,
          databaseStatus: database?.status ?? null,
          databaseCreatedAt: database?.createdAt ?? null,
          adminUserId: adminUserResult?.id ?? null,
          adminUsername: adminUserResult?.username ?? null,
          adminEmail: adminUserResult?.email ?? null,
          adminFirstName: adminUserResult?.firstName ?? null,
          adminLastName: adminUserResult?.lastName ?? null,
          adminLang: adminUserResult?.lang ?? null,
          adminUserCreatedAt: adminUserResult?.createdAt ?? null,
        };
      },
    );
  }

  async createEnvironment(data: IEnvironmentCreateRequest) {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.createEnvironment",
      {
        service: "SuperAdminEnvironmentService",
        method: "createEnvironment",
        section: loggerAppSections.INTERNAL,
        details: {},
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (_span) => {
        const globalDb = getGlobalDB();
        const newId = generateIdForEnvironment();
        const now = Math.floor(Date.now() / 1000);

        await globalDb.insert(globalTables.environments).values({
          id: newId,
          name: data.name.trim(),
          description: data.description ?? null,
          status: "provisioning",
          createdAt: now,
          updatedAt: now,
        });

        return {
          id: newId,
          name: data.name.trim(),
          description: data.description ?? null,
          status: "provisioning",
          createdAt: now,
          updatedAt: now,
        };
      },
    );
  }

  async updateEnvironment(environmentId: string, data: IEnvironmentUpdateRequest) {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.updateEnvironment",
      {
        service: "SuperAdminEnvironmentService",
        method: "updateEnvironment",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select({
            id: globalTables.environments.id,
            name: globalTables.environments.name,
          })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        const hasUpdates = data.name !== undefined || data.description !== undefined ||
          data.customSubdomain !== undefined || data.customDomain !== undefined ||
          data.timezone !== undefined || data.defaultLanguage !== undefined ||
          data.internalNotes !== undefined;
        if (!hasUpdates) {
          throwHttpError("COMMON.BAD_REQUEST");
        }

        const updateData: Record<string, unknown> = {
          updatedAt: Math.floor(Date.now() / 1000),
        };
        if (data.name !== undefined) updateData["name"] = data.name;
        if (data.description !== undefined) updateData["description"] = data.description ?? null;
        if (data.customSubdomain !== undefined) updateData["customSubdomain"] = data.customSubdomain ?? null;
        if (data.customDomain !== undefined) updateData["customDomain"] = data.customDomain ?? null;
        if (data.timezone !== undefined) updateData["timezone"] = data.timezone;
        if (data.defaultLanguage !== undefined) updateData["defaultLanguage"] = data.defaultLanguage;
        if (data.internalNotes !== undefined) updateData["internalNotes"] = data.internalNotes;

        const [updated] = await globalDb
          .update(globalTables.environments)
          .set(updateData)
          .where(eq(globalTables.environments.id, environmentId))
          .returning();

        return {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          status: updated.status,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      },
    );
  }

  async deactivateEnvironment(environmentId: string) {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.deactivateEnvironment",
      {
        service: "SuperAdminEnvironmentService",
        method: "deactivateEnvironment",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select({
            id: globalTables.environments.id,
            status: globalTables.environments.status,
          })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (environment.status === "deactivated") {
          throwHttpError("ENVIRONMENT.ALREADY_DEACTIVATED");
        }

        const now = Math.floor(Date.now() / 1000);
        const [updated] = await globalDb
          .update(globalTables.environments)
          .set({ status: "deactivated", updatedAt: now })
          .where(eq(globalTables.environments.id, environmentId))
          .returning();

        evictTenantDB(environmentId);
        await invalidateEnvironmentCache(environmentId);

        return {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          status: updated.status,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      },
    );
  }

  async destroyEnvironment(environmentId: string, confirmation: string) {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.destroyEnvironment",
      {
        service: "SuperAdminEnvironmentService",
        method: "destroyEnvironment",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select({
            id: globalTables.environments.id,
            name: globalTables.environments.name,
            status: globalTables.environments.status,
          })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (environment.status !== "deactivated" && environment.status !== "provisioning") {
          throwHttpError("ENVIRONMENT.NOT_DEACTIVATED");
        }

        if (confirmation !== environment.name) {
          throwHttpError("ENVIRONMENT.CONFIRMATION_MISMATCH");
        }

        const [dbConfig] = await globalDb
          .select()
          .from(globalTables.environmentSqliteRegistry)
          .where(eq(globalTables.environmentSqliteRegistry.id, environmentId))
          .limit(1);

        await globalDb.transaction(async (tx) => {
          // Enqueue the backup-subtree purge (DD8) INSIDE this teardown tx so it
          // commits atomically with the registry/user/environment deletes. If it
          // were inserted AFTER the tx and the process crashed in between, the
          // destroyed tenant's backup bytes would survive forever (retention
          // hole). Phase C drains this row after the grace window.
          await tx
            .insert(globalTables.environmentBackupPurgeQueue)
            .values(buildEnvironmentPurgeRow(environmentId, Math.floor(Date.now() / 1000)))
            .onConflictDoNothing();

          if (dbConfig) {
            await tx.delete(globalTables.environmentSqliteRegistry)
              .where(eq(globalTables.environmentSqliteRegistry.id, environmentId));
          }

          await tx.delete(globalTables.users)
            .where(eq(globalTables.users.environmentId, environmentId));

          await tx.delete(globalTables.environments)
            .where(eq(globalTables.environments.id, environmentId));
        });

        evictTenantDB(environmentId);

        if (dbConfig) {
          const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
            envConfig.auth.generalEncryptionKey!,
            HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
          );
          const decryptedUrl = new TextDecoder().decode(
            await useSymmetricDecrypt({ key: encryptionKey, data: dbConfig.dbUrlEncrypted }),
          );

          if (decryptedUrl.startsWith("file:")) {
            try {
              await Deno.remove(decryptedUrl.replace("file:", ""));
            } catch {
              // File may not exist — non-critical
            }
          } else if (decryptedUrl.startsWith("libsql:")) {
            useLogger(LoggerLevels.warn, {
              message: "libsql database deletion not yet supported — manual cleanup required",
              section: loggerAppSections.INTERNAL,
              messageKey: "environment.libsql_delete_unsupported",
              details: { environmentId, url_length: decryptedUrl.length },
            });
          }
        }

        try {
          const storage = getStorage();
          await storage.deleteDirectory(`environment-storage/${environmentId}`, { recursive: true });
        } catch (error) {
          useLogger(LoggerLevels.warn, {
            message: "Storage cleanup failed after environment destruction",
            section: loggerAppSections.INTERNAL,
            messageKey: "environment.storage_cleanup_failed",
            details: {
              environmentId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    );
  }

  async suspendEnvironment(environmentId: string) {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.suspendEnvironment",
      {
        service: "SuperAdminEnvironmentService",
        method: "suspendEnvironment",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select({
            id: globalTables.environments.id,
            status: globalTables.environments.status,
          })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (environment.status === "suspended") {
          throwHttpError("ENVIRONMENT.ALREADY_SUSPENDED");
        }

        const now = Math.floor(Date.now() / 1000);
        const [updated] = await globalDb
          .update(globalTables.environments)
          .set({ status: "suspended", updatedAt: now })
          .where(eq(globalTables.environments.id, environmentId))
          .returning();

        evictTenantDB(environmentId);
        await invalidateEnvironmentCache(environmentId);

        return {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          status: updated.status,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      },
    );
  }

  async reactivateEnvironment(environmentId: string) {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.reactivateEnvironment",
      {
        service: "SuperAdminEnvironmentService",
        method: "reactivateEnvironment",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select({
            id: globalTables.environments.id,
            status: globalTables.environments.status,
          })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (environment.status === "active") {
          throwHttpError("ENVIRONMENT.ALREADY_ACTIVE");
        }

        if (environment.status === "deactivated") {
          throwHttpError("ENVIRONMENT.DEACTIVATED_NO_REACTIVATE");
        }

        const now = Math.floor(Date.now() / 1000);
        const [updated] = await globalDb
          .update(globalTables.environments)
          .set({ status: "active", updatedAt: now })
          .where(eq(globalTables.environments.id, environmentId))
          .returning();

        await invalidateEnvironmentCache(environmentId);

        return {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          status: updated.status,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      },
    );
  }

  async registerDatabase(environmentId: string, data: IDatabaseCreateRequestCombined) {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.registerDatabase",
      {
        service: "SuperAdminEnvironmentService",
        method: "registerDatabase",
        section: loggerAppSections.INTERNAL,
        details: { environmentId, isLocal: data.local === true },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;
        span.attributes["is_local"] = data.local === true;

        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select({ id: globalTables.environments.id })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        const [existing] = await globalDb
          .select({ id: globalTables.environmentSqliteRegistry.id })
          .from(globalTables.environmentSqliteRegistry)
          .where(eq(globalTables.environmentSqliteRegistry.id, environmentId))
          .limit(1);

        if (existing) {
          throwHttpError("ENVIRONMENT.ALREADY_REGISTERED");
        }

        let dbUrl: string;
        let dbToken: string;

        if (data.local === true) {
          // Local-based database creation: auto-create file in designated directory
          // Database file name is auto-generated using DB shortcode and environment ID
          const dbName = `${envConfig.database.dbShortCode}${environmentId}`;
          const dbDirectory = "./.data/db";

          // Ensure directory exists
          try {
            await Deno.mkdir(dbDirectory, { recursive: true });
          } catch (error) {
            // Directory may already exist
            if (!(error instanceof Deno.errors.AlreadyExists)) {
              throw error;
            }
          }

          // Create the database file path
          const dbFilePath = `${dbDirectory}/${dbName}.db`;

          // Check if file already exists
          try {
            await Deno.stat(dbFilePath);
            throwHttpError("ENVIRONMENT.LOCAL_DB_EXISTS");
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) {
              throw error;
            }
          }

          // Create an empty SQLite database file by creating a client
          // The file will be created automatically when the client connects
          const localClient = createNodeClient({ url: `file:${dbFilePath}` });
          try {
            const localDb = drizzle(localClient);
            // Run a simple query to ensure the database is properly initialized
            await localDb.$client.execute("SELECT 1");
          } finally {
            localClient.close();
          }

          dbUrl = `file:${dbFilePath}`;
          dbToken = ""; // No token needed for local file-based databases
        } else {
          // URL-based database creation (remote libsql or external file)
          dbUrl = data.url!;
          dbToken = data.token || "";
        }

        const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
          envConfig.auth.generalEncryptionKey!,
          HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
        );

        const dbUrlEncrypted = await useSymmetricEncrypt({
          key: encryptionKey,
          data: new TextEncoder().encode(dbUrl),
        });

        // Only encrypt token if it's non-empty (local databases have no token)
        const dbTokenEncrypted = dbToken.length > 0
          ? await useSymmetricEncrypt({
            key: encryptionKey,
            data: new TextEncoder().encode(dbToken),
          })
          : null;

        const now = Math.floor(Date.now() / 1000);
        await globalDb.insert(globalTables.environmentSqliteRegistry).values({
          id: environmentId,
          dbUrlEncrypted,
          dbTokenEncrypted,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });

        return {
          id: environmentId,
          environmentId: environmentId,
          url: dbUrl,
          token: "***",
          status: "connected" as const,
          createdAt: now,
        };
      },
    );
  }

  async provisionEnvironment(environmentId: string, data: IAdminUserCreateRequest) {
    return await tracedWithServiceErrorHandling(
      "SuperAdminEnvironmentService.provisionEnvironment",
      {
        service: "SuperAdminEnvironmentService",
        method: "provisionEnvironment",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [environment] = await globalDb
          .select({
            id: globalTables.environments.id,
            name: globalTables.environments.name,
            status: globalTables.environments.status,
          })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!environment) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (environment.status !== "provisioning") {
          throwHttpError("ENVIRONMENT.NOT_PROVISIONING");
        }

        const [dbConfig] = await globalDb
          .select()
          .from(globalTables.environmentSqliteRegistry)
          .where(eq(globalTables.environmentSqliteRegistry.id, environmentId))
          .limit(1);

        if (!dbConfig) {
          throwHttpError("ENVIRONMENT.NO_DB");
        }

        const tenantDb = await getTenantDB(environmentId);
        const [existingAdmin] = await tenantDb
          .select({ id: tenantTables.userProfiles.userId })
          .from(tenantTables.userProfiles)
          .where(eq(tenantTables.userProfiles.isAdmin, true))
          .limit(1);

        if (existingAdmin) {
          throwHttpError("ENVIRONMENT.ADMIN_EXISTS");
        }

        const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
          envConfig.auth.generalEncryptionKey!,
          HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
        );

        const decryptedUrl = new TextDecoder().decode(
          await useSymmetricDecrypt({ key: encryptionKey, data: dbConfig.dbUrlEncrypted }),
        );
        // Handle null token (for local databases with no token)
        const decryptedToken = dbConfig.dbTokenEncrypted
          ? new TextDecoder().decode(
            await useSymmetricDecrypt({ key: encryptionKey, data: dbConfig.dbTokenEncrypted }),
          )
          : "";

        const tenantClient = createLibSQLClient(
          decryptedUrl.startsWith("file:") ? { url: decryptedUrl } : { url: decryptedUrl, authToken: decryptedToken },
        );
        try {
          const tenantDb = drizzle(tenantClient, { schema: tenantSchema });
          await migrate(tenantDb, { migrationsFolder: TENANT_MIGRATIONS_DIR });
        } finally {
          tenantClient.close();
        }

        const adminUserId = generateIdForUser();
        await globalDb.insert(globalTables.users).values({
          id: adminUserId,
          email: data.email.toLowerCase().trim(),
          username: data.username.trim(),
          firstName: data.firstName,
          lastName: data.lastName,
          environmentId: environmentId,
          isActive: true,
        });

        await tenantDb.insert(tenantTables.userProfiles).values({
          userId: adminUserId,
          email: data.email.toLowerCase().trim(),
          firstName: data.firstName,
          lastName: data.lastName,
          isAdmin: true,
          language: data.lang,
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
        });

        await tenantDb.insert(tenantTables.userEncryption).values({
          userId: adminUserId,
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
        });

        const passwordResetService = getPasswordResetService();
        const { token } = await passwordResetService.generatePasswordResetToken(adminUserId);

        const registerUrl = `https://${envConfig.public.frontURL}/auth/register/${encodeURIComponent(token)}`;

        fireAndForgetOperation("send-provisioning-email", async () => {
          const emailSenderService = getEmailSenderService();
          await emailSenderService.useSendEmail(
            adminUserId,
            data.email.toLowerCase().trim(),
            {
              fullName: `${data.firstName} ${data.lastName}`,
              email: data.email.toLowerCase().trim(),
              inviteeName: `Admin`,
              environmentName: environment.name,
              registerURL: registerUrl,
              features: EMAIL_SIGN_UP_FEATURES,
            } as unknown as JSON,
            "sign-up",
            data.lang,
          );
        });

        const now = Math.floor(Date.now() / 1000);
        const [updated] = await globalDb
          .update(globalTables.environments)
          .set({ status: "active", updatedAt: now })
          .where(eq(globalTables.environments.id, environmentId))
          .returning();

        await invalidateEnvironmentCache(environmentId);

        const quotasNow = Math.floor(Date.now() / 1000);
        await globalDb
          .insert(globalTables.environmentQuotas)
          .values({
            id: environmentId,
            maxUsers: null,
            maxStorageKb: null,
            maxFileSizeKb: null,
            currentStorageKb: 0,
            createdAt: quotasNow,
            updatedAt: quotasNow,
          })
          .onConflictDoNothing();

        return {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          status: updated.status,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      },
    );
  }
}
