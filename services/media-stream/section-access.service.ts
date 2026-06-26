/**
 * @file services/media-stream/section-access.service.ts
 * @description Section Access service (media stream)
 */
import { ISectionAccessValidator } from "./validators/section-validator.interface.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { traced } from "@services/tracing/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Result of section access validation with decryption information
 */
export interface SectionAccessResult {
  storageMetadataId: string;
  encryptedMasterKey: Uint8Array;
  encryptionMode: "user" | "app";
}

/**
 * Service for managing section-based access validation
 */
export class SectionAccessService {
  private validators: Map<string, ISectionAccessValidator> = new Map();

  /**
   * Register a validator for a specific section
   */
  registerValidator(
    sectionName: string,
    validator: ISectionAccessValidator,
  ): void {
    this.validators.set(sectionName, validator);
  }

  /**
   * Validate user access to a resource in a specific section
   */
  async validateSectionAccess(
    section: string,
    resourceId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL = DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
  ): Promise<string> {
    return await traced(
      "SectionAccessService.validateSectionAccess",
      "auth",
      async (span) => {
        span.attributes["section"] = section;
        span.attributes["resource_id"] = resourceId;
        span.attributes["user_id"] = userId;

        const validator = this.validators.get(section);

        if (!validator) {
          throwHttpError("VALIDATION.INVALID_ENUM_VALUE");
        }

        const storageMetadataId = await validator.validateAccess(
          resourceId,
          userId,
          requiredPermission,
        );

        if (!storageMetadataId) {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        return storageMetadataId;
      },
    );
  }

  /**
   * Get complete access information for a resource
   */
  async getAccessInfo(
    section: string,
    resourceId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL = DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
  ): Promise<SectionAccessResult> {
    return await traced(
      "SectionAccessService.getAccessInfo",
      "auth",
      async (span) => {
        span.attributes["section"] = section;
        span.attributes["resource_id"] = resourceId;
        span.attributes["user_id"] = userId;

        const storageMetadataId = await this.validateSectionAccess(
          section,
          resourceId,
          userId,
          requiredPermission,
        );

        const db = await getTenantDB();

        const [dataKey] = await db
          .select({
            encryptedMasterKey: tenantTables.documentsDataKeys.encryptedMasterKey,
            encryptionMode: tenantTables.documentsDataKeys.encryptionMode,
          })
          .from(tenantTables.documentsDataKeys)
          .where(
            and(
              eq(tenantTables.documentsDataKeys.documentId, resourceId),
              eq(tenantTables.documentsDataKeys.userId, userId),
              eq(tenantTables.documentsDataKeys.isActive, true),
            ),
          )
          .limit(1);

        if (!dataKey) {
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        const encryptionMode = dataKey.encryptionMode === DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED ? "user" as const : "app" as const;

        return {
          storageMetadataId,
          encryptedMasterKey: dataKey.encryptedMasterKey as Uint8Array,
          encryptionMode,
        };
      },
    );
  }
}

// Singleton getter, validator initialization, and init-status check now live in
// ./singletons.ts (re-exported from index.ts) so all three share one instance.
