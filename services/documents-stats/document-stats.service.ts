/**
 * @file services/documents-stats/document-stats.service.ts
 * @description Document Stats service (documents stats)
 */
import { count, eq, sql } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getCache } from "@services/cache/index.ts";
import type { IDocumentStatsResponse } from "@models/documents/stats.model.ts";

export class DocumentStatsService {
  /**
   * Gets comprehensive statistics for a user's documents
   *
   * @param userId - User ID to get stats for
   * @returns Promise<IDocumentStatsResponse> - Statistics object
   */
  async getStats(userId: string): Promise<IDocumentStatsResponse> {
    return await tracedWithServiceErrorHandling(
      "DocumentStatsService.getStats",
      {
        service: "DocumentStatsService",
        method: "getStats",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const [documentsStats, foldersStats, tagsStats, storageStats] = await Promise.all([
          this.getDocumentStats(userId),
          this.getFolderStats(userId),
          this.getTagStats(userId),
          this.getStorageStats(userId),
        ]);

        const stats: IDocumentStatsResponse = {
          documents: documentsStats,
          folders: foldersStats,
          tags: tagsStats,
          storage: storageStats,
        };

        span.attributes["documents_total"] = stats.documents.total;
        span.attributes["folders_total"] = stats.folders.total;
        span.attributes["tags_total"] = stats.tags.total;
        span.attributes["storage_bytes"] = stats.storage.totalBytes;

        return stats;
      },
    );
  }

  /**
   * Gets document counts (total and archived)
   */
  private async getDocumentStats(userId: string) {
    const [result] = await (await getTenantDB())
      .select({
        total: sql<number>`COUNT(*) FILTER (WHERE ${tenantTables.documents.isArchived} = false)`,
        archived: sql<number>`COUNT(*) FILTER (WHERE ${tenantTables.documents.isArchived} = true)`,
      })
      .from(tenantTables.documents)
      .where(eq(tenantTables.documents.ownerId, userId));

    return {
      total: Number(result?.total || 0),
      archived: Number(result?.archived || 0),
    };
  }

  /**
   * Gets folder counts (total and archived)
   */
  private async getFolderStats(userId: string) {
    const [result] = await (await getTenantDB())
      .select({
        total: sql<number>`COUNT(*) FILTER (WHERE ${tenantTables.documentFolders.isArchived} = false)`,
        archived: sql<number>`COUNT(*) FILTER (WHERE ${tenantTables.documentFolders.isArchived} = true)`,
      })
      .from(tenantTables.documentFolders)
      .where(eq(tenantTables.documentFolders.ownerId, userId));

    return {
      total: Number(result?.total || 0),
      archived: Number(result?.archived || 0),
    };
  }

  /**
   * Gets tag count
   */
  private async getTagStats(userId: string) {
    const [result] = await (await getTenantDB())
      .select({
        total: count(),
      })
      .from(tenantTables.documentTags)
      .where(eq(tenantTables.documentTags.userId, userId));

    return {
      total: Number(result?.total || 0),
    };
  }

  /**
   * Gets storage statistics by joining documents with storage metadata
   */
  private async getStorageStats(userId: string) {
    const [result] = await (await getTenantDB())
      .select({
        totalBytes: sql<number>`COALESCE(SUM(${tenantTables.storageMetadata.originalFileSize}), 0)`,
        encryptedBytes: sql<number>`COALESCE(SUM(${tenantTables.storageMetadata.encryptedFileSize}), 0)`,
      })
      .from(tenantTables.documents)
      .innerJoin(
        tenantTables.storageMetadata,
        eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
      )
      .where(eq(tenantTables.documents.ownerId, userId));

    return {
      totalBytes: Number(result?.totalBytes || 0),
      encryptedBytes: Number(result?.encryptedBytes || 0),
    };
  }

  /**
   * Invalidates the stats cache for a user
   * Should be called when documents/folders/tags are created/deleted
   */
  async invalidateCache(userId: string): Promise<void> {
    try {
      const cache = await getCache();
      await cache.delete("document_stats", `stats:${userId}`);
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to invalidate stats cache",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "document_stats.cache.invalidate_error",
        details: { userId, error },
      });
    }
  }
}
