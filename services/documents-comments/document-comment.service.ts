/**
 * @file services/documents/document-comment.service.ts
 * @description Document comment service for CRUD operations and comment management
 *
 * This service handles:
 * - Comment CRUD operations
 * - Threaded comments (replies)
 * - Comment resolution
 * - Position-based comments (for PDFs, images)
 * - Comment archiving
 */

import { and, count, desc, eq, inArray, isNull } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { traced } from "@services/tracing/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { calculatePagination, getTimeNowForStorage } from "@utils/shared/index.ts";
import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import type {
  ICommentFilters,
  ICreateCommentInput,
  IDocumentComment,
  IDocumentCommentWithAuthor,
} from "@models/documents/comment.model.ts";
import type { IPaginatedResult } from "@interfaces/documents.ts";

export class DocumentCommentService {
  private _permissionService: DocumentPermissionService | null = null;

  private get permissionService(): DocumentPermissionService {
    if (!this._permissionService) {
      this._permissionService = new DocumentPermissionService();
    }
    return this._permissionService;
  }

  /**
   * Creates a new comment on a document
   *
   * @param documentId - Document ID
   * @param data - Comment creation data
   * @param userId - ID of the user creating the comment
   * @returns Promise<IDocumentComment> - The created comment
   */
  async createComment(
    documentId: string,
    data: ICreateCommentInput,
    userId: string,
  ): Promise<IDocumentCommentWithAuthor> {
    return await tracedWithServiceErrorHandling(
      "DocumentCommentService.createComment",
      {
        service: "DocumentCommentService",
        method: "createComment",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = documentId;
        span.attributes["user_id"] = userId;
        span.attributes["has_parent"] = !!data.parentCommentId;

        const hasPermission = await traced("createComment.checkPermission", "auth", async (authSpan) => {
          const result = await this.permissionService.checkAccess(
            documentId,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.COMMENT,
          );
          authSpan.attributes["has_permission"] = result;
          return result;
        });

        if (!hasPermission) {
          span.attributes["permission_denied"] = true;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const tenantDb = await getTenantDB();

        if (data.parentCommentId) {
          const parentId = data.parentCommentId;
          const [parentComment] = await traced("createComment.verifyParent", "db.query", async (dbSpan) => {
            const result = await tenantDb
              .select({ id: tenantTables.documentComments.id })
              .from(tenantTables.documentComments)
              .where(
                and(
                  eq(tenantTables.documentComments.id, parentId),
                  eq(tenantTables.documentComments.documentId, documentId),
                ),
              )
              .limit(1);

            dbSpan.attributes["parent_found"] = result.length > 0;
            return result;
          });

          if (!parentComment) {
            span.attributes["parent_comment_found"] = false;
            throwHttpError("DOCUMENT_COMMENT.PARENT_NOT_FOUND");
          }
        }

        const now = getTimeNowForStorage();

        const comment = await traced("createComment.insertComment", "db.query", async (dbSpan) => {
          const result = await databaseCreateWithRetry(
            async (generatedCommentId) => {
              const [created] = await tenantDb
                .insert(tenantTables.documentComments)
                .values({
                  id: generatedCommentId,
                  documentId,
                  parentCommentId: data.parentCommentId || null,
                  content: data.content,
                  authorId: userId,
                  isResolved: false,
                  resolvedById: null,
                  resolvedAt: null,
                  isArchived: false,
                  archivedAt: null,
                  archivedById: null,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning();

              if (!created) {
                throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
              }
              return created;
            },
            generateIdRandomWithTimestamp,
          );

          dbSpan.attributes["comment_created"] = true;
          return result;
        });

        span.attributes["comment_id"] = comment.id;
        span.attributes["success"] = true;

        // Fetch the comment with author information for the response
        const commentWithAuthor = await this.getCommentWithAuthor(comment.id, documentId, userId);

        if (!commentWithAuthor) {
          throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
        }

        return commentWithAuthor;
      },
    );
  }

  /**
   * Finds a comment by ID
   *
   * @param id - Comment ID
   * @param documentId - Document ID for validation
   * @returns Promise<IDocumentComment | null> - The comment if found
   */
  async findCommentById(
    id: string,
    documentId: string,
  ): Promise<IDocumentComment | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentCommentService.findCommentById",
      {
        service: "DocumentCommentService",
        method: "findCommentById",
        section: loggerAppSections.DOCUMENTS,
        details: { commentId: id, documentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["comment_id"] = id;
        span.attributes["document_id"] = documentId;

        const tenantDb = await getTenantDB();
        const [comment] = await traced("findCommentById.query", "db.query", async (dbSpan) => {
          const result = await tenantDb
            .select()
            .from(tenantTables.documentComments)
            .where(
              and(
                eq(tenantTables.documentComments.id, id),
                eq(tenantTables.documentComments.documentId, documentId),
              ),
            )
            .limit(1);

          dbSpan.attributes["found"] = result.length > 0;
          return result;
        });

        span.attributes["found"] = !!comment;
        return comment ? (comment as IDocumentComment) : null;
      },
    );
  }

  /**
   * Gets a comment with author information
   *
   * @param id - Comment ID
   * @param documentId - Document ID for validation
   * @returns Promise<IDocumentCommentWithAuthor | null> - Comment with author info
   */
  async getCommentWithAuthor(
    id: string,
    documentId: string,
    userId: string,
  ): Promise<IDocumentCommentWithAuthor | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentCommentService.getCommentWithAuthor",
      {
        service: "DocumentCommentService",
        method: "getCommentWithAuthor",
        section: loggerAppSections.DOCUMENTS,
        details: { commentId: id, documentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["comment_id"] = id;
        span.attributes["user_id"] = userId;

        const hasPermission = await traced("getCommentWithAuthor.checkPermission", "auth", async (authSpan) => {
          const result = await this.permissionService.checkAccess(
            documentId,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
          );
          authSpan.attributes["has_permission"] = result;
          return result;
        });

        if (!hasPermission) {
          span.attributes["permission_denied"] = true;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const tenantDb = await getTenantDB();
        const result = await traced("getCommentWithAuthor.query", "db.query", async (dbSpan) => {
          const data = await tenantDb
            .select({
              comment: tenantTables.documentComments,
              authorUserId: tenantTables.userProfiles.userId,
              authorFirstName: tenantTables.userProfiles.firstName,
              authorLastName: tenantTables.userProfiles.lastName,
            })
            .from(tenantTables.documentComments)
            .innerJoin(
              tenantTables.userProfiles,
              eq(tenantTables.documentComments.authorId, tenantTables.userProfiles.userId),
            )
            .where(
              and(
                eq(tenantTables.documentComments.id, id),
                eq(tenantTables.documentComments.documentId, documentId),
              ),
            )
            .limit(1);

          dbSpan.attributes["found"] = data.length > 0;
          return data;
        });

        if (!result.length) {
          span.attributes["found"] = false;
          return null;
        }

        const row = result[0];

        let resolvedBy = null;
        if (row.comment.resolvedById) {
          const resolvedById = row.comment.resolvedById;
          const [resolvedByResult] = await traced("getCommentWithAuthor.resolvedBy", "db.query", async (dbSpan) => {
            const data = await tenantDb
              .select({
                userId: tenantTables.userProfiles.userId,
                firstName: tenantTables.userProfiles.firstName,
                lastName: tenantTables.userProfiles.lastName,
              })
              .from(tenantTables.userProfiles)
              .where(eq(tenantTables.userProfiles.userId, resolvedById))
              .limit(1);

            dbSpan.attributes["found"] = data.length > 0;
            return data;
          });

          if (resolvedByResult) {
            resolvedBy = {
              id: resolvedByResult.userId,
              name: `${resolvedByResult.firstName} ${resolvedByResult.lastName}`,
            };
          }
        }

        span.attributes["found"] = true;
        return {
          ...row.comment,
          author: {
            id: row.authorUserId,
            name: `${row.authorFirstName} ${row.authorLastName}`,
          },
          resolvedBy,
        } as IDocumentCommentWithAuthor;
      },
    );
  }

  /**
   * Deletes a comment (soft delete by archiving)
   *
   * @param id - Comment ID
   * @param documentId - Document ID for validation
   * @param userId - ID of user performing deletion
   */
  async deleteComment(
    id: string,
    documentId: string,
    userId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentCommentService.deleteComment",
      {
        service: "DocumentCommentService",
        method: "deleteComment",
        section: loggerAppSections.DOCUMENTS,
        details: { commentId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["comment_id"] = id;
        span.attributes["user_id"] = userId;

        const hasDocumentAccess = await this.permissionService.checkAccess(
          documentId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );

        if (!hasDocumentAccess) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const comment = await this.findCommentById(id, documentId);
        if (!comment) {
          span.attributes["comment_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (comment.authorId !== userId) {
          span.attributes["not_author"] = true;
          throwHttpError("COMMON.NOT_FOUND");
        }

        const now = getTimeNowForStorage();
        const tenantDb = await getTenantDB();

        await traced("deleteComment.archive", "db.query", async (dbSpan) => {
          await tenantDb
            .update(tenantTables.documentComments)
            .set({
              isArchived: true,
              archivedAt: now,
              archivedById: userId,
            })
            .where(
              and(
                eq(tenantTables.documentComments.id, id),
                eq(tenantTables.documentComments.documentId, documentId),
              ),
            );

          dbSpan.attributes["archived"] = true;
        });

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Resolves a comment
   *
   * @param id - Comment ID
   * @param documentId - Document ID for validation
   * @param userId - ID of user resolving the comment
   */
  async resolveComment(
    id: string,
    documentId: string,
    userId: string,
  ): Promise<IDocumentCommentWithAuthor> {
    return await tracedWithServiceErrorHandling(
      "DocumentCommentService.resolveComment",
      {
        service: "DocumentCommentService",
        method: "resolveComment",
        section: loggerAppSections.DOCUMENTS,
        details: { commentId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["comment_id"] = id;
        span.attributes["user_id"] = userId;

        const hasPermission = await traced("resolveComment.checkPermission", "auth", async (authSpan) => {
          const result = await this.permissionService.checkAccess(
            documentId,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.COMMENT,
          );
          authSpan.attributes["has_permission"] = result;
          return result;
        });

        if (!hasPermission) {
          span.attributes["permission_denied"] = true;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const comment = await this.findCommentById(id, documentId);
        if (!comment) {
          span.attributes["comment_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        const now = getTimeNowForStorage();
        const tenantDb = await getTenantDB();

        const [_resolved] = await traced("resolveComment.update", "db.query", async (dbSpan) => {
          const result = await tenantDb
            .update(tenantTables.documentComments)
            .set({
              isResolved: true,
              resolvedById: userId,
              resolvedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(tenantTables.documentComments.id, id),
                eq(tenantTables.documentComments.documentId, documentId),
              ),
            )
            .returning();

          dbSpan.attributes["resolved"] = result.length > 0;
          return result;
        });

        span.attributes["success"] = true;

        // Fetch the comment with author information for the response
        const commentWithAuthor = await this.getCommentWithAuthor(id, documentId, userId);

        if (!commentWithAuthor) {
          throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
        }

        return commentWithAuthor;
      },
    );
  }

  /**
   * Unresolves a comment
   *
   * @param id - Comment ID
   * @param documentId - Document ID for validation
   * @param userId - ID of user unresolving the comment
   */
  async unresolveComment(
    id: string,
    documentId: string,
    userId: string,
  ): Promise<IDocumentCommentWithAuthor> {
    return await tracedWithServiceErrorHandling(
      "DocumentCommentService.unresolveComment",
      {
        service: "DocumentCommentService",
        method: "unresolveComment",
        section: loggerAppSections.DOCUMENTS,
        details: { commentId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["comment_id"] = id;
        span.attributes["user_id"] = userId;

        const hasPermission = await traced("unresolveComment.checkPermission", "auth", async (authSpan) => {
          const result = await this.permissionService.checkAccess(
            documentId,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.COMMENT,
          );
          authSpan.attributes["has_permission"] = result;
          return result;
        });

        if (!hasPermission) {
          span.attributes["permission_denied"] = true;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const comment = await this.findCommentById(id, documentId);
        if (!comment) {
          span.attributes["comment_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        const now = getTimeNowForStorage();
        const tenantDb = await getTenantDB();

        const [_unresolved] = await traced("unresolveComment.update", "db.query", async (dbSpan) => {
          const result = await tenantDb
            .update(tenantTables.documentComments)
            .set({
              isResolved: false,
              resolvedById: null,
              resolvedAt: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(tenantTables.documentComments.id, id),
                eq(tenantTables.documentComments.documentId, documentId),
              ),
            )
            .returning();

          dbSpan.attributes["unresolved"] = result.length > 0;
          return result;
        });

        span.attributes["success"] = true;

        // Fetch the comment with author information for the response
        const commentWithAuthor = await this.getCommentWithAuthor(id, documentId, userId);

        if (!commentWithAuthor) {
          throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
        }

        return commentWithAuthor;
      },
    );
  }

  /**
   * Lists comments for a document with optional filters
   *
   * @param documentId - Document ID
   * @param filters - Optional filters
   * @returns Promise<IDocumentCommentWithAuthor[]> - Array of comments with author info
   */
  async listComments(
    documentId: string,
    filters: ICommentFilters = {},
    userId: string,
  ): Promise<IDocumentCommentWithAuthor[]> {
    return await tracedWithServiceErrorHandling(
      "DocumentCommentService.listComments",
      {
        service: "DocumentCommentService",
        method: "listComments",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = documentId;
        span.attributes["user_id"] = userId;
        span.attributes["has_filters"] = Object.keys(filters).length > 0;

        const hasPermission = await traced("listComments.checkPermission", "auth", async (authSpan) => {
          const result = await this.permissionService.checkAccess(
            documentId,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
          );
          authSpan.attributes["has_permission"] = result;
          return result;
        });

        if (!hasPermission) {
          span.attributes["permission_denied"] = true;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }
        const conditions = [eq(tenantTables.documentComments.documentId, documentId)];

        if (filters.isResolved !== undefined) {
          conditions.push(eq(tenantTables.documentComments.isResolved, filters.isResolved));
        }

        if (!filters.includeArchived) {
          conditions.push(eq(tenantTables.documentComments.isArchived, false));
        }

        if (filters.parentCommentId !== undefined) {
          if (filters.parentCommentId === null) {
            conditions.push(isNull(tenantTables.documentComments.parentCommentId));
          } else {
            conditions.push(eq(tenantTables.documentComments.parentCommentId, filters.parentCommentId));
          }
        }

        if (filters.authorId) {
          conditions.push(eq(tenantTables.documentComments.authorId, filters.authorId));
        }

        const tenantDb = await getTenantDB();
        const results = await traced("listComments.queryComments", "db.query", async (dbSpan) => {
          const data = await tenantDb
            .select({
              comment: tenantTables.documentComments,
              authorUserId: tenantTables.userProfiles.userId,
              authorFirstName: tenantTables.userProfiles.firstName,
              authorLastName: tenantTables.userProfiles.lastName,
            })
            .from(tenantTables.documentComments)
            .innerJoin(
              tenantTables.userProfiles,
              eq(tenantTables.documentComments.authorId, tenantTables.userProfiles.userId),
            )
            .where(and(...conditions))
            .orderBy(desc(tenantTables.documentComments.createdAt));

          dbSpan.attributes["comment_count"] = data.length;
          return data;
        });

        const resolvedByIds = [
          ...new Set(
            results
              .map((r) => r.comment.resolvedById)
              .filter((id): id is string => id !== null),
          ),
        ];

        const resolvedByUsers = resolvedByIds.length > 0
          ? await traced("listComments.fetchResolvedByUsers", "db.query", async (dbSpan) => {
            const data = await tenantDb
              .select({
                userId: tenantTables.userProfiles.userId,
                firstName: tenantTables.userProfiles.firstName,
                lastName: tenantTables.userProfiles.lastName,
              })
              .from(tenantTables.userProfiles)
              .where(inArray(tenantTables.userProfiles.userId, resolvedByIds));

            dbSpan.attributes["user_count"] = data.length;
            return data;
          })
          : [];

        const resolvedByMap = new Map(
          resolvedByUsers.map((u) => [
            u.userId,
            { id: u.userId, name: `${u.firstName} ${u.lastName}` },
          ]),
        );

        const comments = results.map((row) => ({
          ...row.comment,
          author: {
            id: row.authorUserId,
            name: `${row.authorFirstName} ${row.authorLastName}`,
          },
          resolvedBy: row.comment.resolvedById ? resolvedByMap.get(row.comment.resolvedById) || null : null,
        })) as IDocumentCommentWithAuthor[];

        span.attributes["result_count"] = comments.length;
        return comments;
      },
    );
  }

  /**
   * Gets comments with nested replies (threaded view) with pagination
   *
   * Pagination is applied to top-level comments only. All replies for the
   * paginated top-level comments are included.
   *
   * @param documentId - Document ID
   * @param filters - Optional filters (includes pagination for top-level comments)
   * @param userId - User ID for permission check
   * @returns Promise<IPaginatedResult<IDocumentCommentWithAuthor>> - Paginated threaded comments
   */
  async listCommentsThreaded(
    documentId: string,
    filters: ICommentFilters = {},
    userId: string,
  ): Promise<IPaginatedResult<IDocumentCommentWithAuthor>> {
    return await tracedWithServiceErrorHandling(
      "DocumentCommentService.listCommentsThreaded",
      {
        service: "DocumentCommentService",
        method: "listCommentsThreaded",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = documentId;
        span.attributes["user_id"] = userId;

        // First, check permission
        const hasPermission = await traced("listCommentsThreaded.checkPermission", "auth", async (authSpan) => {
          const result = await this.permissionService.checkAccess(
            documentId,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
          );
          authSpan.attributes["has_permission"] = result;
          return result;
        });

        if (!hasPermission) {
          span.attributes["permission_denied"] = true;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const page = filters.page || 1;
        const limit = Math.min(filters.limit || 50, 100); // Default 50, max 100

        // Build base conditions for top-level comments
        const topLevelConditions = [
          eq(tenantTables.documentComments.documentId, documentId),
          isNull(tenantTables.documentComments.parentCommentId), // Only top-level comments
        ];

        if (filters.isResolved !== undefined) {
          topLevelConditions.push(eq(tenantTables.documentComments.isResolved, filters.isResolved));
        }

        if (!filters.includeArchived) {
          topLevelConditions.push(eq(tenantTables.documentComments.isArchived, false));
        }

        if (filters.authorId) {
          topLevelConditions.push(eq(tenantTables.documentComments.authorId, filters.authorId));
        }

        const tenantDb = await getTenantDB();

        // Get total count of top-level comments for pagination
        const [countResult] = await tenantDb
          .select({ count: count() })
          .from(tenantTables.documentComments)
          .where(and(...topLevelConditions));

        const total = countResult?.count || 0;
        const { offset, pagination } = calculatePagination(page, limit, total);

        // Get paginated top-level comments with author info
        const topLevelResults = await traced("listCommentsThreaded.queryTopLevel", "db.query", async (dbSpan) => {
          const data = await tenantDb
            .select({
              comment: tenantTables.documentComments,
              authorUserId: tenantTables.userProfiles.userId,
              authorFirstName: tenantTables.userProfiles.firstName,
              authorLastName: tenantTables.userProfiles.lastName,
            })
            .from(tenantTables.documentComments)
            .innerJoin(
              tenantTables.userProfiles,
              eq(tenantTables.documentComments.authorId, tenantTables.userProfiles.userId),
            )
            .where(and(...topLevelConditions))
            .orderBy(desc(tenantTables.documentComments.createdAt))
            .limit(limit)
            .offset(offset);

          dbSpan.attributes["comment_count"] = data.length;
          return data;
        });

        if (topLevelResults.length === 0) {
          span.attributes["top_level_count"] = 0;
          span.attributes["total_count"] = 0;
          return {
            items: [],
            pagination,
          };
        }

        // Get IDs of paginated top-level comments
        const topLevelIds = topLevelResults.map((r) => r.comment.id);

        // Fetch all replies (we'll need to recursively fetch nested replies too)
        const allReplies: Array<
          {
            comment: typeof tenantTables.documentComments.$inferSelect;
            authorUserId: string;
            authorFirstName: string;
            authorLastName: string;
          }
        > = [];
        let parentIds = [...topLevelIds];
        const maxDepth = 10; // Prevent infinite recursion
        let currentDepth = 0;

        while (parentIds.length > 0 && currentDepth < maxDepth) {
          const replyConditions = [
            eq(tenantTables.documentComments.documentId, documentId),
            inArray(tenantTables.documentComments.parentCommentId, parentIds),
          ];

          if (!filters.includeArchived) {
            replyConditions.push(eq(tenantTables.documentComments.isArchived, false));
          }

          const replies = await tenantDb
            .select({
              comment: tenantTables.documentComments,
              authorUserId: tenantTables.userProfiles.userId,
              authorFirstName: tenantTables.userProfiles.firstName,
              authorLastName: tenantTables.userProfiles.lastName,
            })
            .from(tenantTables.documentComments)
            .innerJoin(
              tenantTables.userProfiles,
              eq(tenantTables.documentComments.authorId, tenantTables.userProfiles.userId),
            )
            .where(and(...replyConditions))
            .orderBy(desc(tenantTables.documentComments.createdAt));

          if (replies.length === 0) break;

          allReplies.push(...replies);
          parentIds = replies.map((r) => r.comment.id);
          currentDepth++;
        }

        // Combine top-level comments and all replies
        const allComments = [...topLevelResults, ...allReplies];

        // Fetch resolved by users for all comments
        const resolvedByIds = [
          ...new Set(
            allComments
              .map((r) => r.comment.resolvedById)
              .filter((id): id is string => id !== null),
          ),
        ];

        const resolvedByUsers = resolvedByIds.length > 0
          ? await traced("listCommentsThreaded.fetchResolvedByUsers", "db.query", async (dbSpan) => {
            const data = await tenantDb
              .select({
                userId: tenantTables.userProfiles.userId,
                firstName: tenantTables.userProfiles.firstName,
                lastName: tenantTables.userProfiles.lastName,
              })
              .from(tenantTables.userProfiles)
              .where(inArray(tenantTables.userProfiles.userId, resolvedByIds));

            dbSpan.attributes["user_count"] = data.length;
            return data;
          })
          : [];

        const resolvedByMap = new Map(
          resolvedByUsers.map((u) => [
            u.userId,
            { id: u.userId, name: `${u.firstName} ${u.lastName}` },
          ]),
        );

        // Build comment map with author and resolvedBy info
        const commentMap = new Map<string, IDocumentCommentWithAuthor>();
        allComments.forEach((row) => {
          commentMap.set(row.comment.id, {
            ...row.comment,
            author: {
              id: row.authorUserId,
              name: `${row.authorFirstName} ${row.authorLastName}`,
            },
            resolvedBy: row.comment.resolvedById ? resolvedByMap.get(row.comment.resolvedById) || null : null,
            replies: [],
          } as IDocumentCommentWithAuthor);
        });

        // Build the tree structure
        const topLevelComments: IDocumentCommentWithAuthor[] = [];

        allComments.forEach((row) => {
          const commentWithReplies = commentMap.get(row.comment.id)!;
          if (!commentWithReplies) return;

          if (row.comment.parentCommentId === null) {
            // Top-level comment
            topLevelComments.push(commentWithReplies);
          } else {
            // Reply - add to parent's replies array
            const parent = commentMap.get(row.comment.parentCommentId);
            if (parent) {
              if (!parent.replies) {
                parent.replies = [];
              }
              parent.replies.push(commentWithReplies);
            }
          }
        });

        span.attributes["top_level_count"] = topLevelComments.length;
        span.attributes["total_count"] = allComments.length;
        span.attributes["page"] = page;
        span.attributes["limit"] = limit;
        span.attributes["depth"] = currentDepth;

        return {
          items: topLevelComments,
          pagination,
        };
      },
    );
  }

  /**
   * Gets comment count for a document
   *
   * @param documentId - Document ID
   * @param includeArchived - Whether to include archived comments
   * @returns Promise<number> - Comment count
   */
  async getCommentCount(
    documentId: string,
    includeArchived = false,
  ): Promise<number> {
    return await tracedWithServiceErrorHandling<number>(
      "DocumentCommentService.getCommentCount",
      {
        service: "DocumentCommentService",
        method: "getCommentCount",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = documentId;

        const conditions = [eq(tenantTables.documentComments.documentId, documentId)];

        if (!includeArchived) {
          conditions.push(eq(tenantTables.documentComments.isArchived, false));
        }

        const tenantDb = await getTenantDB();
        const docCount: number = await traced<number>(
          "getCommentCount.query",
          "db.query",
          async (dbSpan): Promise<number> => {
            const [data]: Array<{ count: number }> = await tenantDb
              .select({ count: count() })
              .from(tenantTables.documentComments)
              .where(and(...conditions));

            const cnt: number = Number(data?.count ?? 0);
            dbSpan.attributes["count"] = cnt;
            return cnt;
          },
        );

        span.attributes["count"] = docCount;
        return docCount;
      },
    );
  }
}
