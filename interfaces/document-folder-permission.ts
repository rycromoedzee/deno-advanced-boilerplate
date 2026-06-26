/**
 * @file interfaces/document-folder-permission.ts
 * @description Structural contract for the folder-permission service.
 *
 * This interface exists to break a cross-domain import cycle between
 * `services/documents-permission` and `services/document-folders`:
 * `document-folders/folder-write.service.ts` depends on
 * `DocumentPermissionInheritanceService`, while
 * `documents-permission/permission-inheritance.service.ts` previously imported the
 * concrete `DocumentFolderPermissionService` class. Depending on the interface
 * here lets the documents-permission domain reference the folder-permission
 * surface by structural typing without importing the concrete class, removing the
 * documents-permission -> document-folders edge. The concrete
 * `DocumentFolderPermissionService` satisfies this interface automatically.
 */

import type { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import type { IDocumentFolder } from "@models/documents/folder.model.ts";
import type { IDocumentResponse } from "@models/documents/index.ts";
import type { IFolderAccessContext } from "@interfaces/documents.ts";

/** Folder access metadata logged alongside permission checks. */
export interface IFolderAccessMetadata {
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
}

/** Result of verifying a public share token against a folder. */
export interface IPublicShareAccessResult {
  folderId: string;
  isValid: boolean;
  folder: IDocumentFolder | null;
}

/**
 * Structural contract for folder-permission lookup and access control.
 *
 * Implemented by `DocumentFolderPermissionService`; consumed cross-domain
 * (e.g. by the documents-permission domain) to avoid a hard import cycle.
 */
export interface IDocumentFolderPermissionService {
  checkFolderAccess(
    folderId: string,
    userId: string,
    requiredPermission?: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    metadata?: IFolderAccessMetadata,
  ): Promise<boolean>;

  getAccessLevel(
    folderId: string,
    userId: string,
  ): Promise<DB_ENUM_PERMISSION_ACCESS_LEVEL | null>;

  getEffectivePermission(
    folderId: string,
    userId: string,
  ): Promise<string | number>;

  verifyPublicShareAccess(
    token: string,
    shareKey: string,
    password?: string,
    metadata?: IFolderAccessMetadata,
  ): Promise<IPublicShareAccessResult>;

  invalidateFolderCache(folderId: string): Promise<void>;

  invalidateUserCache(userId: string): Promise<void>;

  invalidatePermissionCache(folderId: string, userId: string): Promise<void>;

  getAccessibleDocuments(
    folderId: string,
    context: IFolderAccessContext,
  ): Promise<IDocumentResponse[]>;

  getAccessibleSubfolders(
    folderId: string,
    context: IFolderAccessContext,
  ): Promise<IDocumentFolder[]>;

  batchCheckFolderAccess(
    folderIds: string[],
    userId: string,
    environmentId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<Map<string, boolean>>;
}
