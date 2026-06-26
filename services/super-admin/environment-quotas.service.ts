/**
 * @file services/super-admin/environment-quotas.service.ts
 * @description Environment Quotas service (super admin)
 */
import { eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import type { IEnvironmentQuotasUpdateRequest } from "@models/super-admin/index.ts";

export class EnvironmentQuotasService {
  async getQuotas(environmentId: string) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentQuotasService.getQuotas",
      {
        service: "EnvironmentQuotasService",
        method: "getQuotas",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [env] = await globalDb
          .select({ id: globalTables.environments.id })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!env) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        const [quotas] = await globalDb
          .select()
          .from(globalTables.environmentQuotas)
          .where(eq(globalTables.environmentQuotas.id, environmentId))
          .limit(1);

        return {
          maxUsers: quotas?.maxUsers ?? null,
          maxStorageKb: quotas?.maxStorageKb ?? null,
          maxFileSizeKb: quotas?.maxFileSizeKb ?? null,
          currentStorageKb: quotas?.currentStorageKb ?? 0,
        };
      },
    );
  }

  async updateQuotas(environmentId: string, data: IEnvironmentQuotasUpdateRequest) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentQuotasService.updateQuotas",
      {
        service: "EnvironmentQuotasService",
        method: "updateQuotas",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();

        const [env] = await globalDb
          .select({ id: globalTables.environments.id })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!env) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        const hasUpdates = data.maxUsers !== undefined || data.maxStorageKb !== undefined || data.maxFileSizeKb !== undefined;
        if (!hasUpdates) {
          throwHttpError("COMMON.BAD_REQUEST");
        }

        const [existing] = await globalDb
          .select({ id: globalTables.environmentQuotas.id })
          .from(globalTables.environmentQuotas)
          .where(eq(globalTables.environmentQuotas.id, environmentId))
          .limit(1);

        const now = Math.floor(Date.now() / 1000);

        if (existing) {
          const updateData: Record<string, unknown> = { updatedAt: now };
          if (data.maxUsers !== undefined) updateData["maxUsers"] = data.maxUsers;
          if (data.maxStorageKb !== undefined) updateData["maxStorageKb"] = data.maxStorageKb;
          if (data.maxFileSizeKb !== undefined) updateData["maxFileSizeKb"] = data.maxFileSizeKb;

          await globalDb
            .update(globalTables.environmentQuotas)
            .set(updateData)
            .where(eq(globalTables.environmentQuotas.id, environmentId));
        } else {
          await globalDb
            .insert(globalTables.environmentQuotas)
            .values({
              id: environmentId,
              maxUsers: data.maxUsers ?? null,
              maxStorageKb: data.maxStorageKb ?? null,
              maxFileSizeKb: data.maxFileSizeKb ?? null,
              currentStorageKb: 0,
              createdAt: now,
              updatedAt: now,
            });
        }

        const [updated] = await globalDb
          .select()
          .from(globalTables.environmentQuotas)
          .where(eq(globalTables.environmentQuotas.id, environmentId))
          .limit(1);

        return {
          maxUsers: updated.maxUsers ?? null,
          maxStorageKb: updated.maxStorageKb ?? null,
          maxFileSizeKb: updated.maxFileSizeKb ?? null,
          currentStorageKb: updated.currentStorageKb,
        };
      },
    );
  }
}
