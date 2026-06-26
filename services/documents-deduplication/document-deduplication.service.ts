/**
 * @file services/documents-deduplication/document-deduplication.service.ts
 * @description Service for detecting and managing duplicate documents
 *
 * Duplicates are identified by their SHA-256 content hash.
 * Users can:
 * - Find duplicates across their documents
 * - Keep a document (mark as duplicateAllowed = true)
 * - Remove a duplicate (soft delete)
 */

import { and, count, eq, inArray, isNotNull, sql } from "@deps";
import { traced } from "@services/tracing/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

export interface DuplicateGroup {
  contentHash: string;
  originalFileSize: number;
  documents: DuplicateDocument[];
}

export interface DuplicateDocument {
  documentId: string;
  name: string;
  description: string | null;
  mimeType: string;
  originalName: string;
  originalFileSize: number;
  folderId: string | null;
  folderName: string | null;
  isArchived: boolean;
  duplicateAllowed: boolean;
  createdAt: number;
  previewUrl: string | null;
}

export interface FindDuplicatesResult {
  totalDuplicateGroups: number;
  totalDuplicateFiles: number;
  potentialSavingsBytes: number;
  groups: DuplicateGroup[];
}

export class DocumentDeduplicationService {
  /**
   * Find all duplicate documents for a user
   * Groups documents by their content hash
   */
  async findDuplicates(
    userId: string,
    environmentId: string,
    options: {
      includeArchived?: boolean;
      excludeAllowed?: boolean;
    } = {},
  ): Promise<FindDuplicatesResult> {
    return await traced("DocumentDeduplicationService.findDuplicates", "service", async (span) => {
      span.attributes["user_id"] = userId;
      span.attributes["environment_id"] = environmentId;

      const db = await getTenantDB();
      const { includeArchived = false, excludeAllowed = true } = options;

      // First, find all content hashes that have duplicates
      // Only consider files that have a content hash
      const duplicateHashesQuery = await db
        .select({
          contentHash: tenantTables.storageMetadata.contentHash,
          count: count(),
        })
        .from(tenantTables.documents)
        .innerJoin(
          tenantTables.storageMetadata,
          eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
        )
        .where(
          and(
            eq(tenantTables.documents.ownerId, userId),
            isNotNull(tenantTables.storageMetadata.contentHash),
            includeArchived ? undefined : eq(tenantTables.documents.isArchived, false),
            excludeAllowed ? eq(tenantTables.storageMetadata.duplicateAllowed, false) : undefined,
          ),
        )
        .groupBy(tenantTables.storageMetadata.contentHash)
        .having(sql`count(*) > 1`);

      const duplicateHashes = duplicateHashesQuery;

      if (duplicateHashes.length === 0) {
        return {
          totalDuplicateGroups: 0,
          totalDuplicateFiles: 0,
          potentialSavingsBytes: 0,
          groups: [],
        };
      }

      // Now get all documents for these hashes
      const hashValues = duplicateHashes.map((h) => h.contentHash).filter(Boolean) as string[];

      const duplicateDocuments = await db
        .select({
          documentId: tenantTables.documents.id,
          name: tenantTables.documents.name,
          description: tenantTables.documents.description,
          folderId: tenantTables.documents.folderId,
          isArchived: tenantTables.documents.isArchived,
          createdAt: tenantTables.documents.createdAt,
          contentHash: tenantTables.storageMetadata.contentHash,
          mimeType: tenantTables.storageMetadata.mimeType,
          originalName: tenantTables.storageMetadata.originalName,
          originalFileSize: tenantTables.storageMetadata.originalFileSize,
          duplicateAllowed: tenantTables.storageMetadata.duplicateAllowed,
          thumbnailPath: tenantTables.storageMetadata.thumbnailPath,
          folderName: tenantTables.documentFolders.name,
        })
        .from(tenantTables.documents)
        .innerJoin(
          tenantTables.storageMetadata,
          eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
        )
        .leftJoin(
          tenantTables.documentFolders,
          eq(tenantTables.documents.folderId, tenantTables.documentFolders.id),
        )
        .where(
          and(
            eq(tenantTables.documents.ownerId, userId),
            sql`${tenantTables.storageMetadata.contentHash} IN (${sql.join(hashValues.map((h) => sql`${h}`), sql`, `)})`,
            includeArchived ? undefined : eq(tenantTables.documents.isArchived, false),
          ),
        )
        .orderBy(tenantTables.storageMetadata.contentHash, tenantTables.documents.createdAt);

      // Group by content hash
      const groupsMap = new Map<string, DuplicateDocument[]>();
      const fileSizeByHash = new Map<string, number>();

      for (const doc of duplicateDocuments) {
        const hash = doc.contentHash!;
        if (!groupsMap.has(hash)) {
          groupsMap.set(hash, []);
          fileSizeByHash.set(hash, doc.originalFileSize);
        }

        // Build preview URL for images and videos (any document with a thumbnail)
        let previewUrl: string | null = null;
        if (doc.thumbnailPath) {
          previewUrl = `/api/documents/${doc.documentId}/preview`;
        }

        groupsMap.get(hash)!.push({
          documentId: doc.documentId,
          name: doc.name,
          description: doc.description,
          mimeType: doc.mimeType,
          originalName: doc.originalName,
          originalFileSize: doc.originalFileSize,
          folderId: doc.folderId,
          folderName: doc.folderName || null,
          isArchived: doc.isArchived,
          duplicateAllowed: doc.duplicateAllowed,
          createdAt: doc.createdAt,
          previewUrl,
        });
      }

      // Calculate potential savings (sum of all but one file per group)
      let totalDuplicateFiles = 0;
      let potentialSavingsBytes = 0;

      const groups: DuplicateGroup[] = [];
      for (const [contentHash, documents] of groupsMap) {
        const fileSize = fileSizeByHash.get(contentHash) || 0;
        const duplicateCount = documents.length - 1; // All but the first are "duplicates"

        totalDuplicateFiles += duplicateCount;
        potentialSavingsBytes += fileSize * duplicateCount;

        groups.push({
          contentHash,
          originalFileSize: fileSize,
          documents,
        });
      }

      span.attributes["total_groups"] = groups.length;
      span.attributes["total_duplicates"] = totalDuplicateFiles;
      span.attributes["potential_savings_bytes"] = potentialSavingsBytes;

      return {
        totalDuplicateGroups: groups.length,
        totalDuplicateFiles,
        potentialSavingsBytes,
        groups,
      };
    });
  }

  /**
   * Mark a document as "allowed" duplicate
   * This prevents it from showing up in future duplicate scans
   */
  async keepDuplicate(
    documentId: string,
    userId: string,
    _environmentId: string,
  ): Promise<boolean> {
    return await traced("DocumentDeduplicationService.keepDuplicate", "service", async (span) => {
      span.attributes["document_id"] = documentId;
      span.attributes["user_id"] = userId;

      const db = await getTenantDB();

      // Verify the document belongs to the user
      const document = await db
        .select({
          id: tenantTables.documents.id,
          storageMetadataId: tenantTables.documents.storageMetadataId,
        })
        .from(tenantTables.documents)
        .where(
          and(
            eq(tenantTables.documents.id, documentId),
            eq(tenantTables.documents.ownerId, userId),
          ),
        )
        .limit(1);

      if (document.length === 0) {
        span.attributes["error"] = "document_not_found";
        return false;
      }

      // Update the storage metadata to mark as duplicate allowed
      await db
        .update(tenantTables.storageMetadata)
        .set({ duplicateAllowed: true })
        .where(eq(tenantTables.storageMetadata.id, document[0].storageMetadataId));

      span.attributes["success"] = true;
      return true;
    });
  }

  /**
   * Remove the duplicate allowed flag from a document
   */
  async unkeepDuplicate(
    documentId: string,
    userId: string,
    _environmentId: string,
  ): Promise<boolean> {
    return await traced("DocumentDeduplicationService.unkeepDuplicate", "service", async (span) => {
      span.attributes["document_id"] = documentId;
      span.attributes["user_id"] = userId;

      const db = await getTenantDB();

      // Verify the document belongs to the user
      const document = await db
        .select({
          id: tenantTables.documents.id,
          storageMetadataId: tenantTables.documents.storageMetadataId,
        })
        .from(tenantTables.documents)
        .where(
          and(
            eq(tenantTables.documents.id, documentId),
            eq(tenantTables.documents.ownerId, userId),
          ),
        )
        .limit(1);

      if (document.length === 0) {
        span.attributes["error"] = "document_not_found";
        return false;
      }

      // Update the storage metadata to remove duplicate allowed flag
      await db
        .update(tenantTables.storageMetadata)
        .set({ duplicateAllowed: false })
        .where(eq(tenantTables.storageMetadata.id, document[0].storageMetadataId));

      span.attributes["success"] = true;
      return true;
    });
  }

  /**
   * Bulk keep multiple duplicates
   */
  async bulkKeepDuplicates(
    documentIds: string[],
    userId: string,
    _environmentId: string,
  ): Promise<{ success: number; failed: number }> {
    return await traced("DocumentDeduplicationService.bulkKeepDuplicates", "service", async (span) => {
      span.attributes["document_count"] = documentIds.length;
      span.attributes["user_id"] = userId;

      if (documentIds.length === 0) {
        return { success: 0, failed: 0 };
      }

      const db = await getTenantDB();

      // Batch verify ownership and get storage metadata IDs
      const docs = await db
        .select({
          id: tenantTables.documents.id,
          storageMetadataId: tenantTables.documents.storageMetadataId,
        })
        .from(tenantTables.documents)
        .where(
          and(
            inArray(tenantTables.documents.id, documentIds),
            eq(tenantTables.documents.ownerId, userId),
          ),
        );

      if (docs.length === 0) {
        span.attributes["failed"] = documentIds.length;
        return { success: 0, failed: documentIds.length };
      }

      const storageMetadataIds = docs.map((d) => d.storageMetadataId);

      // Batch update all storage metadata records
      await db
        .update(tenantTables.storageMetadata)
        .set({ duplicateAllowed: true })
        .where(inArray(tenantTables.storageMetadata.id, storageMetadataIds));

      const success = docs.length;
      const failed = documentIds.length - success;

      span.attributes["success_count"] = success;
      span.attributes["failed_count"] = failed;

      return { success, failed };
    });
  }
}
