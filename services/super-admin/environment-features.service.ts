/**
 * @file services/super-admin/environment-features.service.ts
 * @description Environment Features service (super admin)
 */
import { eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import type { IEnvironmentFeaturesUpdateRequest } from "@models/super-admin/index.ts";
import { invalidateEnvironmentCache } from "@middleware/feature-guard.middleware.ts";

const FEATURE_KEY_TO_COLUMN: Record<string, string> = {
  documents: "featureDocuments",
  encryption: "featureEncryption",
  publicSharing: "featurePublicSharing",
  notes: "featureNotes",
  knowledgeBase: "featureKnowledgeBase",
};

export class EnvironmentFeaturesService {
  async getFeatures(environmentId: string) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentFeaturesService.getFeatures",
      {
        service: "EnvironmentFeaturesService",
        method: "getFeatures",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();
        const [env] = await globalDb
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

        if (!env) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        return {
          documents: env.featureDocuments,
          encryption: env.featureEncryption,
          publicSharing: env.featurePublicSharing,
          notes: env.featureNotes,
          knowledgeBase: env.featureKnowledgeBase,
        };
      },
    );
  }

  async updateFeatures(environmentId: string, data: IEnvironmentFeaturesUpdateRequest) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentFeaturesService.updateFeatures",
      {
        service: "EnvironmentFeaturesService",
        method: "updateFeatures",
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

        const updateData: Record<string, unknown> = {
          updatedAt: Math.floor(Date.now() / 1000),
        };

        let hasUpdates = false;
        for (const [apiKey, dbColumn] of Object.entries(FEATURE_KEY_TO_COLUMN)) {
          const value = data[apiKey as keyof IEnvironmentFeaturesUpdateRequest];
          if (value !== undefined) {
            updateData[dbColumn] = value;
            hasUpdates = true;
          }
        }

        if (!hasUpdates) {
          throwHttpError("COMMON.BAD_REQUEST");
        }

        const [updated] = await globalDb
          .update(globalTables.environments)
          .set(updateData)
          .where(eq(globalTables.environments.id, environmentId))
          .returning({
            featureDocuments: globalTables.environments.featureDocuments,
            featureEncryption: globalTables.environments.featureEncryption,
            featurePublicSharing: globalTables.environments.featurePublicSharing,
            featureNotes: globalTables.environments.featureNotes,
            featureKnowledgeBase: globalTables.environments.featureKnowledgeBase,
          });

        await invalidateEnvironmentCache(environmentId);

        return {
          documents: updated.featureDocuments,
          encryption: updated.featureEncryption,
          publicSharing: updated.featurePublicSharing,
          notes: updated.featureNotes,
          knowledgeBase: updated.featureKnowledgeBase,
        };
      },
    );
  }
}
