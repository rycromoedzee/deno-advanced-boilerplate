/**
 * @file services/media-stream/validators/documents-section.validator.ts
 * @description Documents Section validator (media stream validators)
 */
import { ISectionAccessValidator } from "./section-validator.interface.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { DataAccessService } from "@services/encryption/data-access.service.ts";
import { eq } from "@deps";
import { traced } from "@services/tracing/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Documents section validator using the generic DataAccessService
 */
export class DocumentsSectionValidator implements ISectionAccessValidator {
  readonly sectionName = "documents";
  private dataAccessService: DataAccessService;

  constructor() {
    this.dataAccessService = new DataAccessService({
      tableName: tenantTables.documentsDataKeys,
      resourceIdColumn: "documentId",
    });
  }

  async validateAccess(
    documentId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<string | null> {
    return await traced(
      "DocumentsSectionValidator.validateAccess",
      "auth",
      async (span) => {
        span.attributes["section"] = this.sectionName;
        span.attributes["document_id"] = documentId;
        span.attributes["user_id"] = userId;
        span.attributes["required_permission"] = requiredPermission;

        const permissionResult = await this.dataAccessService.checkPermission(
          documentId,
          userId,
          requiredPermission,
        );

        if (!permissionResult.hasPermission) {
          return null;
        }

        return await this.getStorageMetadataId(documentId);
      },
    );
  }

  async getStorageMetadataId(documentId: string): Promise<string | null> {
    return await traced(
      "DocumentsSectionValidator.getStorageMetadataId",
      "db.query",
      async (_span) => {
        const db = await getTenantDB();
        const result = await db
          .select({
            storageMetadataId: tenantTables.documents.storageMetadataId,
          })
          .from(tenantTables.documents)
          .where(eq(tenantTables.documents.id, documentId))
          .limit(1);

        if (result.length === 0 || !result[0].storageMetadataId) {
          return null;
        }

        return result[0].storageMetadataId;
      },
    );
  }
}
