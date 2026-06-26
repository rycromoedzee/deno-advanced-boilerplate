/**
 * @file interfaces/documents.ts
 * @description Document management interfaces
 * These interfaces define the structure for document-related operations and data
 *
 * DEPRECATION NOTICE:
 * Many interfaces have been migrated to model files for better validation and type safety:
 * - IDocument -> @models/documents/document.model.ts
 * - IDocumentFolder -> @models/documents/folder.model.ts
 * - IDocumentTag -> @models/documents/tag.model.ts
 * - IDocumentComment -> @models/documents/comment.model.ts
 * - IFolderAccessLog -> @models/documents/folder-sharing.model.ts
 * - IDocumentAccessLog -> @models/documents/document-sharing.model.ts
 */

/**
 * Document filters interface
 */
export interface IDocumentFilters {
  name?: string;
  folderId?: string | null; // null for root documents (folderId IS NULL)
  tags?: string[];
  contentType?: string;
  search?: string;
  archived?: "true" | "false" | "both";
  isFavorited?: boolean;
}

/**
 * Folder filters interface
 */
export interface IFolderFilters {
  parentFolderId?: string | null;
  archived?: "true" | "false" | "both";
  search?: string;
}

/**
 * Pagination parameters interface
 */
export interface IPaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * Pagination metadata interface
 */
export interface IPaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Paginated result interface
 */
export interface IPaginatedResult<T> {
  items: T[];
  pagination: IPaginationMetadata;
}

/**
 * Folder access context interface
 */
export interface IFolderAccessContext {
  userId: string | null;
  environmentId?: string | null;
  isPublicAccess: boolean;
  accessMethod: "direct" | "public_share" | "internal_share";
  shareToken?: string;
}

/**
 * Permission inheritance result interface
 */
export interface IPermissionInheritanceResult {
  documentId: string;
  originalEncryptionMode: number;
  success: boolean;
  action: "added_to_acl" | "asymmetric_shared" | "skipped" | "error";
  error?: string;
}
