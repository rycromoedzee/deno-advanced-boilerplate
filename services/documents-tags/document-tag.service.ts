/**
 * @file services/documents/document-tag.service.ts
 * @description Document tag service for CRUD operations and tag management
 *
 * This service handles:
 * - Tag CRUD operations
 * - Tag resolution from strings/IDs/names
 * - Auto-creation of tags
 * - Duplicate prevention (case-insensitive)
 * - Tag assignment to documents
 * - Batch loading for performance
 */

import { and, count, desc, eq, ilike, inArray, sql } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { PAGINATION_DEFAULTS } from "@constants/pagination.ts";
import { throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { calculatePagination, getTimeNow, getTimeNowForStorage } from "@utils/shared/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { generateRandomColor, getUniqueTagIds, normalizeTagName } from "@utils/tag-utils.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { getDocumentStatsService } from "@services/documents-stats/singletons.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";
import type { ICreateTagInput, ITagFilters, IUpdateTagInput, TagInput } from "@models/documents/tag.model.ts";
import type { IDocumentTag } from "@models/documents/tag.model.ts";

/**
 * Result of a bulk operation
 */
export interface IBulkTagOperationResult {
  success: boolean;
  failedCount: number;
  errors: Array<{
    documentId: string;
    error: string;
  }>;
}

export class DocumentTagService {
  /**
   * Creates a new tag
   *
   * @param data - Tag creation data
   * @param userId - ID of the user creating the tag
   * @returns Promise<IDocumentTag> - The created tag
   */
  async createTag(
    data: ICreateTagInput,
    userId: string,
  ): Promise<IDocumentTag> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.createTag",
      {
        service: "DocumentTagService",
        method: "createTag",
        section: loggerAppSections.DOCUMENTS,
        details: { name: data.name, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag_name"] = data.name;
        span.attributes["user_id"] = userId;

        // Check for existing tag with same name (case-insensitive)
        const existing = await this.findTagByName(data.name, userId);
        if (existing) {
          span.attributes["duplicate_found"] = true;
          throwHttpErrorWithCustomMessage(
            "VALIDATION.DUPLICATE_VALUE",
            `Tag with name "${data.name}" already exists for this user`,
          );
        }

        const now = Math.floor(getTimeNow() / 1000);
        const color = data.color || generateRandomColor();

        const tag = await databaseCreateWithRetry(
          async (generatedTagId) => {
            const [created] = await (await getTenantDB())
              .insert(tenantTables.documentTags)
              .values({
                id: generatedTagId,
                name: data.name.trim(),
                color,
                description: data.description || null,
                userId,
                createdById: userId,
                usageCount: 0,
                createdAt: now,
                updatedAt: now,
              })
              .returning();

            if (!created) {
              throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
            }
            return created;
          },
          () => generateIdRandom(14),
        );

        span.attributes["tag_id"] = tag.id;
        span.attributes["success"] = true;

        // Invalidate stats cache since tag count changed
        getDocumentStatsService().invalidateCache(userId).catch((err) => {
          useLogger(
            LoggerLevels.warn,
            {
              details: { userId },
              message: "Error invalidating stats cache after tag creation",
              messageKey: "stats_cache.invalidate_error",
              raw: err,
              section: loggerAppSections.DOCUMENTS,
            },
          );
        });

        return tag as IDocumentTag;
      },
    );
  }

  /**
   * Finds a tag by ID
   *
   * @param id - Tag ID
   * @param userId - User ID for scope validation
   * @returns Promise<IDocumentTag | null> - The tag if found
   */
  async findTagById(
    id: string,
    userId: string,
  ): Promise<IDocumentTag | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.findTagById",
      {
        service: "DocumentTagService",
        method: "findTagById",
        section: loggerAppSections.DOCUMENTS,
        details: { tagId: id },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag_id"] = id;

        const [tag] = await (await getTenantDB())
          .select()
          .from(tenantTables.documentTags)
          .where(
            and(
              eq(tenantTables.documentTags.id, id),
              eq(tenantTables.documentTags.userId, userId),
            ),
          )
          .limit(1);

        span.attributes["found"] = !!tag;
        return tag ? (tag as IDocumentTag) : null;
      },
    );
  }

  /**
   * Finds a tag by name (case-insensitive)
   *
   * @param name - Tag name
   * @param userId - User ID for scope
   * @returns Promise<IDocumentTag | null> - The tag if found
   */
  async findTagByName(
    name: string,
    userId: string,
  ): Promise<IDocumentTag | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.findTagByName",
      {
        service: "DocumentTagService",
        method: "findTagByName",
        section: loggerAppSections.DOCUMENTS,
        details: { name },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag_name"] = name;

        const normalizedName = normalizeTagName(name);

        const [tag] = await (await getTenantDB())
          .select()
          .from(tenantTables.documentTags)
          .where(
            and(
              sql`LOWER(${tenantTables.documentTags.name}) = ${normalizedName}`,
              eq(tenantTables.documentTags.userId, userId),
            ),
          )
          .limit(1);

        span.attributes["found"] = !!tag;
        return tag ? (tag as IDocumentTag) : null;
      },
    );
  }

  /**
   * Finds tag by ID or name
   *
   * @param idOrName - Tag ID or name
   * @param userId - User ID
   * @returns Promise<IDocumentTag | null> - The tag if found
   */
  async findTagByIdOrName(
    idOrName: string,
    userId: string,
  ): Promise<IDocumentTag | null> {
    // Try ID first
    const tag = await this.findTagById(idOrName, userId);
    if (tag) return tag;

    // Try name if ID lookup fails
    return await this.findTagByName(idOrName, userId);
  }

  /**
   * Updates a tag
   *
   * @param id - Tag ID
   * @param data - Update data
   * @param userId - ID of user performing update
   * @returns Promise<IDocumentTag> - The updated tag
   */
  async updateTag(
    id: string,
    data: IUpdateTagInput,
    userId: string,
  ): Promise<IDocumentTag> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.updateTag",
      {
        service: "DocumentTagService",
        method: "updateTag",
        section: loggerAppSections.DOCUMENTS,
        details: { tagId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag_id"] = id;
        span.attributes["user_id"] = userId;

        // Verify tag exists
        const existing = await this.findTagById(id, userId);
        if (!existing) {
          span.attributes["tag_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Check if name is being changed and if new name already exists
        if (data.name && data.name.trim() !== existing.name) {
          const nameConflict = await this.findTagByName(data.name, userId);
          if (nameConflict && nameConflict.id !== id) {
            throwHttpErrorWithCustomMessage(
              "VALIDATION.DUPLICATE_VALUE",
              `Tag with name "${data.name}" already exists`,
            );
          }
        }

        const now = getTimeNowForStorage();

        const updateData: Record<string, unknown> = {
          updatedAt: now,
        };

        if (data.name !== undefined) updateData.name = data.name.trim();
        if (data.color !== undefined) updateData.color = data.color;
        if (data.description !== undefined) updateData.description = data.description;

        const [updated] = await (await getTenantDB())
          .update(tenantTables.documentTags)
          .set(updateData)
          .where(
            and(
              eq(tenantTables.documentTags.id, id),
              eq(tenantTables.documentTags.userId, userId),
            ),
          )
          .returning();

        span.attributes["success"] = true;
        return updated as IDocumentTag;
      },
    );
  }

  /**
   * Deletes a tag
   * Only allowed if tag has no active assignments
   *
   * @param id - Tag ID
   * @param userId - ID of user performing deletion
   */
  async deleteTag(
    id: string,
    userId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.deleteTag",
      {
        service: "DocumentTagService",
        method: "deleteTag",
        section: loggerAppSections.DOCUMENTS,
        details: { tagId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag_id"] = id;
        span.attributes["user_id"] = userId;

        // Verify tag exists
        const tag = await this.findTagById(id, userId);
        if (!tag) {
          span.attributes["tag_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Delete all tag assignments first
        await (await getTenantDB())
          .delete(tenantTables.documentTagAssignments)
          .where(eq(tenantTables.documentTagAssignments.tagId, id));

        // Then delete the tag itself
        await (await getTenantDB())
          .delete(tenantTables.documentTags)
          .where(
            and(
              eq(tenantTables.documentTags.id, id),
              eq(tenantTables.documentTags.userId, userId),
            ),
          );

        // Invalidate stats cache since tag count changed
        getDocumentStatsService().invalidateCache(userId).catch((err) => {
          useLogger(
            LoggerLevels.warn,
            {
              details: { userId },
              message: "Error invalidating stats cache after tag deletion",
              messageKey: "stats_cache.invalidate_error",
              raw: err,
              section: loggerAppSections.DOCUMENTS,
            },
          );
        });

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Lists all tags for a user with pagination
   *
   * @param userId - User ID
   * @param filters - Optional filters (includes pagination)
   * @returns Promise<{ items: IDocumentTag[]; total: number; page: number; limit: number; totalPages: number }> - Paginated tags
   */
  async listTags(
    userId: string,
    filters: ITagFilters = {},
  ): Promise<{ items: IDocumentTag[]; total: number; page: number; limit: number; totalPages: number }> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.listTags",
      {
        service: "DocumentTagService",
        method: "listTags",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["has_filters"] = Object.keys(filters).length > 0;

        const conditions = [eq(tenantTables.documentTags.userId, userId)];

        // Apply search filter
        if (filters.search) {
          conditions.push(
            ilike(tenantTables.documentTags.name, `%${filters.search}%`),
          );
        }

        // Build and execute query with sorting
        const sortBy = filters.sortBy || "name";
        const sortOrder = filters.sortOrder || "asc";
        const page = filters.page || 1;
        const limit = Math.min(filters.limit || 100, PAGINATION_DEFAULTS.MAX_LIMIT); // Normal API ceiling (100)

        const sortColumn = sortBy === "usageCount"
          ? tenantTables.documentTags.usageCount
          : sortBy === "createdAt"
          ? tenantTables.documentTags.createdAt
          : tenantTables.documentTags.name;

        // Get total count for pagination metadata
        const [countResult] = await (await getTenantDB())
          .select({ count: count() })
          .from(tenantTables.documentTags)
          .where(and(...conditions));

        const total = countResult?.count || 0;
        const { offset, pagination } = calculatePagination(page, limit, total);

        // Get paginated results
        const tags = sortOrder === "desc"
          ? await (await getTenantDB())
            .select()
            .from(tenantTables.documentTags)
            .where(and(...conditions))
            .orderBy(desc(sortColumn))
            .limit(limit)
            .offset(offset)
          : await (await getTenantDB())
            .select()
            .from(tenantTables.documentTags)
            .where(and(...conditions))
            .orderBy(sortColumn)
            .limit(limit)
            .offset(offset);

        span.attributes["result_count"] = tags.length;
        span.attributes["total_count"] = total;
        span.attributes["page"] = page;
        span.attributes["limit"] = limit;

        return {
          items: tags as IDocumentTag[],
          total: pagination.total,
          page: pagination.page,
          limit: pagination.limit,
          totalPages: pagination.totalPages,
        };
      },
    );
  }

  /**
   * Resolves or creates a single tag from input
   * Handles string, ID reference, and name reference
   *
   * @param input - Tag input (string | {id} | {name})
   * @param userId - User ID for tag creation
   * @returns Promise<string> - Resolved tag ID
   */
  async resolveOrCreateTag(
    input: TagInput,
    userId: string,
  ): Promise<string> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.resolveOrCreateTag",
      {
        service: "DocumentTagService",
        method: "resolveOrCreateTag",
        section: loggerAppSections.DOCUMENTS,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        // Handle string input (tag name)
        if (typeof input === "string") {
          const tag = await this.findOrCreateByName(input, userId);
          span.attributes["resolved_from"] = "string";
          return tag.id;
        }

        // Handle object with ID
        if ("id" in input && typeof input.id === "string") {
          const tag = await this.findTagById(input.id, userId);
          if (!tag) {
            throwHttpErrorWithCustomMessage(
              "COMMON.NOT_FOUND",
              `Tag with ID "${input.id}" not found`,
            );
          }
          span.attributes["resolved_from"] = "id";
          return tag.id;
        }

        // Handle object with name
        if ("name" in input && typeof input.name === "string") {
          const tag = await this.findOrCreateByName(input.name, userId);
          span.attributes["resolved_from"] = "name";
          return tag.id;
        }

        throwHttpError("DOCUMENT.TAG_INPUT_FORMAT_INVALID");
      },
    );
  }

  /**
   * Resolves or creates multiple tags from mixed inputs
   * Returns unique tag IDs
   *
   * @param inputs - Array of tag inputs
   * @param userId - User ID for tag creation
   * @returns Promise<string[]> - Array of unique tag IDs
   */
  async resolveOrCreateTags(
    inputs: TagInput[],
    userId: string,
  ): Promise<string[]> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.resolveOrCreateTags",
      {
        service: "DocumentTagService",
        method: "resolveOrCreateTags",
        section: loggerAppSections.DOCUMENTS,
        details: { inputCount: inputs.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["input_count"] = inputs.length;

        const tagIds: string[] = [];

        for (const input of inputs) {
          const tagId = await this.resolveOrCreateTag(input, userId);
          tagIds.push(tagId);
        }

        // Return unique tag IDs
        const uniqueIds = getUniqueTagIds(tagIds);
        span.attributes["resolved_count"] = uniqueIds.length;
        return uniqueIds;
      },
    );
  }

  /**
   * Finds tag by name or creates it if it doesn't exist
   * This is the auto-creation logic
   *
   * @param name - Tag name
   * @param userId - User ID for creation
   * @returns Promise<IDocumentTag> - Existing or new tag
   */
  private async findOrCreateByName(
    name: string,
    userId: string,
  ): Promise<IDocumentTag> {
    const existing = await this.findTagByName(name, userId);
    if (existing) {
      return existing;
    }

    // Create new tag with random color
    return await this.createTag(
      {
        name,
        color: generateRandomColor(),
        description: null,
      },
      userId,
    );
  }

  /**
   * Gets all tags for a specific document
   *
   * @param documentId - Document ID
   * @returns Promise<IDocumentTag[]> - Array of tags
   */
  async getDocumentTags(documentId: string): Promise<IDocumentTag[]> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.getDocumentTags",
      {
        service: "DocumentTagService",
        method: "getDocumentTags",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = documentId;

        const results = await (await getTenantDB())
          .select({
            tag: tenantTables.documentTags,
          })
          .from(tenantTables.documentTags)
          .innerJoin(
            tenantTables.documentTagAssignments,
            eq(tenantTables.documentTags.id, tenantTables.documentTagAssignments.tagId),
          )
          .where(eq(tenantTables.documentTagAssignments.documentId, documentId))
          .orderBy(tenantTables.documentTags.name);

        const tags = results.map((row: Record<string, unknown>) => row.tag as IDocumentTag);
        span.attributes["tag_count"] = tags.length;
        return tags;
      },
    );
  }

  /**
   * Batch loads tags for multiple documents (performance optimization)
   *
   * @param documentIds - Array of document IDs
   * @returns Promise<Record<string, IDocumentTag[]>> - Tags grouped by document ID
   */
  async getTagsForDocuments(documentIds: string[]): Promise<Record<string, IDocumentTag[]>> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.getTagsForDocuments",
      {
        service: "DocumentTagService",
        method: "getTagsForDocuments",
        section: loggerAppSections.DOCUMENTS,
        details: { documentCount: documentIds.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_count"] = documentIds.length;

        if (documentIds.length === 0) {
          return {};
        }

        const results = await (await getTenantDB())
          .select({
            documentId: tenantTables.documentTagAssignments.documentId,
            tag: tenantTables.documentTags,
          })
          .from(tenantTables.documentTags)
          .innerJoin(
            tenantTables.documentTagAssignments,
            eq(tenantTables.documentTags.id, tenantTables.documentTagAssignments.tagId),
          )
          .where(inArray(tenantTables.documentTagAssignments.documentId, documentIds))
          .orderBy(tenantTables.documentTags.name);

        // Group by document ID
        const tagsByDoc: Record<string, IDocumentTag[]> = {};
        for (const row of results) {
          if (!tagsByDoc[row.documentId]) {
            tagsByDoc[row.documentId] = [];
          }
          tagsByDoc[row.documentId].push(row.tag as IDocumentTag);
        }

        span.attributes["total_tags_loaded"] = results.length;
        return tagsByDoc;
      },
    );
  }

  /**
   * Assigns tags to a document
   *
   * @param documentId - Document ID
   * @param tagIds - Array of tag IDs to assign
   * @param userId - User ID performing the assignment
   */
  async assignTagsToDocument(
    documentId: string,
    tagIds: string[],
    userId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.assignTagsToDocument",
      {
        service: "DocumentTagService",
        method: "assignTagsToDocument",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, tagCount: tagIds.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = documentId;
        span.attributes["tag_count"] = tagIds.length;

        if (tagIds.length === 0) {
          return;
        }

        const now = getTimeNowForStorage();

        await (await getTenantDB()).transaction(async (tx) => {
          // Insert assignments (ignore duplicates)
          const assignments = tagIds.map((tagId) => ({
            documentId,
            tagId,
            assignedById: userId,
            createdAt: now,
          }));

          await tx
            .insert(tenantTables.documentTagAssignments)
            .values(assignments)
            .onConflictDoNothing();

          // Increment usage counts for each tag
          for (const tagId of tagIds) {
            await tx
              .update(tenantTables.documentTags)
              .set({
                usageCount: sql`${tenantTables.documentTags.usageCount} + 1`,
                updatedAt: now,
              })
              .where(eq(tenantTables.documentTags.id, tagId));
          }
        });

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Removes tags from a document
   *
   * @param documentId - Document ID
   * @param tagIds - Array of tag IDs to remove
   * @param userId - User ID performing the removal
   */
  async removeTagsFromDocument(
    documentId: string,
    tagIds: string[],
    userId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.removeTagsFromDocument",
      {
        service: "DocumentTagService",
        method: "removeTagsFromDocument",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, tagCount: tagIds.length, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = documentId;
        span.attributes["tag_count"] = tagIds.length;
        span.attributes["user_id"] = userId;

        if (tagIds.length === 0) {
          return;
        }

        const now = getTimeNowForStorage();

        await (await getTenantDB()).transaction(async (tx) => {
          // Delete assignments
          await tx
            .delete(tenantTables.documentTagAssignments)
            .where(
              and(
                eq(tenantTables.documentTagAssignments.documentId, documentId),
                inArray(tenantTables.documentTagAssignments.tagId, tagIds),
              ),
            );

          // Decrement usage counts (ensure it doesn't go below 0)
          for (const tagId of tagIds) {
            await tx
              .update(tenantTables.documentTags)
              .set({
                usageCount: sql`GREATEST(${tenantTables.documentTags.usageCount} - 1, 0)`,
                updatedAt: now,
              })
              .where(eq(tenantTables.documentTags.id, tagId));
          }
        });

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Cleans up unused tags for a user
   * Deletes tags with usageCount of 0
   *
   * @param userId - User ID
   * @returns Promise<number> - Number of tags deleted
   */
  async cleanupUnusedTags(userId: string): Promise<number> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.cleanupUnusedTags",
      {
        service: "DocumentTagService",
        method: "cleanupUnusedTags",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const result = await (await getTenantDB())
          .delete(tenantTables.documentTags)
          .where(
            and(
              eq(tenantTables.documentTags.userId, userId),
              eq(tenantTables.documentTags.usageCount, 0),
            ),
          )
          .returning({ id: tenantTables.documentTags.id });

        const deletedCount = result.length;

        span.attributes["deleted_count"] = deletedCount;
        return deletedCount;
      },
    );
  }

  /**
   * Performs bulk tag assignment to multiple documents
   *
   * @param documentIds - Array of document IDs to tag
   * @param tagIds - Array of tag IDs to assign
   * @param userId - ID of the user performing the assignment
   * @param environmentId - Environment ID
   * @param permissionService - Document permission service for checking access
   * @returns Promise<IBulkTagOperationResult> - Result of the bulk operation
   */
  async bulkAssignTags(
    documentIds: string[],
    tagIds: string[],
    userId: string,
    environmentId: string,
    permissionService: DocumentPermissionService,
  ): Promise<IBulkTagOperationResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentTagService.bulkAssignTags",
      {
        service: "DocumentTagService",
        method: "bulkAssignTags",
        section: loggerAppSections.DOCUMENTS,
        details: { documentIds, tagIds, userId, environmentId },
      },
      "DOCUMENT.BULK_ASSIGN_TAGS_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["document_count"] = documentIds.length;
        span.attributes["tag_count"] = tagIds.length;

        // Validate document limits
        if (documentIds.length === 0) {
          throwHttpError("DOCUMENT.BULK_OPERATION_BAD_REQUEST");
        }

        if (documentIds.length > BULK_OPERATION_CONSTRAINTS.MAX_DOCUMENTS) {
          throwHttpError("DOCUMENT.BULK_OPERATION_BAD_REQUEST");
        }

        const uniqueDocIds = new Set(documentIds);
        if (uniqueDocIds.size !== documentIds.length) {
          throwHttpError("DOCUMENT.BULK_OPERATION_BAD_REQUEST");
        }

        // Validate tag limits
        if (tagIds.length === 0) {
          throwHttpError("DOCUMENT.BULK_OPERATION_BAD_REQUEST");
        }

        if (tagIds.length > BULK_OPERATION_CONSTRAINTS.MAX_TAGS) {
          throwHttpError("DOCUMENT.BULK_OPERATION_BAD_REQUEST");
        }

        // Verify all tags exist
        const existingTags = await (await getTenantDB(environmentId))
          .select({ id: tenantTables.documentTags.id })
          .from(tenantTables.documentTags)
          .where(
            and(
              inArray(tenantTables.documentTags.id, tagIds),
              eq(tenantTables.documentTags.userId, userId),
            ),
          );

        if (existingTags.length !== tagIds.length) {
          throwHttpError("DOCUMENT.TAGS_NOT_FOUND");
        }

        // Check permissions for all documents
        const permissionMap = new Map<string, boolean>();
        await Promise.all(
          documentIds.map(async (documentId) => {
            try {
              const hasAccess = await permissionService.checkAccess(
                documentId,
                userId,
                DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
              );
              permissionMap.set(documentId, hasAccess);
            } catch (error) {
              await useLogger(LoggerLevels.warn, {
                message: "Error checking permission for document in bulk tag assignment",
                section: loggerAppSections.DEBUG,
                messageKey: "bulk_tag_permission_check_error",
                details: { documentId, userId, error },
              });
              permissionMap.set(documentId, false);
            }
          }),
        );

        const allowedIds: string[] = [];
        const errors: Array<{ documentId: string; error: string }> = [];

        for (const [documentId, hasAccess] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(documentId);
          } else {
            errors.push({
              documentId,
              error: "Access denied: insufficient permissions to assign tags",
            });
          }
        }

        if (allowedIds.length > 0) {
          await Promise.all(
            allowedIds.map((documentId) => this.assignTagsToDocument(documentId, tagIds, userId)),
          );
        }

        span.attributes["success"] = errors.length === 0;

        return {
          success: errors.length === 0,
          failedCount: errors.length,
          errors,
        };
      },
    );
  }
}
