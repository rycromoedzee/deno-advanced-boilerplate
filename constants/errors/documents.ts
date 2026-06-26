/**
 * @file constants/errors/documents.ts
 * @description Documents error message constants
 */
/**
 * Document Management Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Document-specific errors
 */
export const DOCUMENT_ERRORS = {
  BAD_REQUEST: {
    message: "Bad request",
    messageKey: "document.bad-request",
    statusCode: 400,
  },
  INVALID_SHARE_OPTIONS: {
    message: "Invalid share options",
    messageKey: "document.invalid-share-options",
    statusCode: 400,
  },
  PUBLIC_SHARE_BAD_REQUEST: {
    message: "Bad request for public share",
    messageKey: "document.public-share-bad-request",
    statusCode: 400,
  },
  NOT_FOUND: {
    message: "Document not found",
    messageKey: "document.not-found",
    statusCode: 404,
  },
  ACCESS_DENIED: {
    message: "Access denied to document",
    messageKey: "document.access-denied",
    statusCode: 403,
  },
  UPLOAD_FAILED: {
    message: "Document upload failed",
    messageKey: "document.upload-failed",
    statusCode: 422,
  },
  INVALID_FILE_TYPE: {
    message: "Invalid file type",
    messageKey: "document.invalid-file-type",
    statusCode: 400,
  },
  FILE_TOO_LARGE: {
    message: "File size exceeds maximum allowed",
    messageKey: "document.file-too-large",
    statusCode: 413,
  },
  DUPLICATE_FAILED: {
    message: "Failed to duplicate document",
    messageKey: "document.duplicate-failed",
    statusCode: 500,
  },
  MOVE_FAILED: {
    message: "Failed to move document",
    messageKey: "document.move-failed",
    statusCode: 400,
  },
  LIST_FAILED: {
    message: "Failed to list documents",
    messageKey: "document.list-failed",
    statusCode: 500,
  },
  DOWNLOAD_FAILED: {
    message: "Failed to download document",
    messageKey: "document.download-failed",
    statusCode: 500,
  },
  ARCHIVE_FAILED: {
    message: "Failed to archive document",
    messageKey: "document.archive-failed",
    statusCode: 500,
  },
  RESTORE_FAILED: {
    message: "Failed to restore document",
    messageKey: "document.restore-failed",
    statusCode: 500,
  },
  DELETE_FAILED: {
    message: "Failed to delete document",
    messageKey: "document.delete-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update document",
    messageKey: "document.update-failed",
    statusCode: 500,
  },
  ENCRYPTION_KEY_NOT_FOUND: {
    message: "Encryption key not found for document",
    messageKey: "document.encryption-key-not-found",
    statusCode: 500,
  },
  BULK_DELETE_FAILED: {
    message: "Bulk delete operation failed",
    messageKey: "document.bulk-delete-failed",
    statusCode: 500,
  },
  BULK_ARCHIVE_FAILED: {
    message: "Bulk archive operation failed",
    messageKey: "document.bulk-archive-failed",
    statusCode: 500,
  },
  BULK_RESTORE_FAILED: {
    message: "Bulk restore operation failed",
    messageKey: "document.bulk-restore-failed",
    statusCode: 500,
  },
  BULK_OPERATION_BAD_REQUEST: {
    message: "Bad request for bulk operation",
    messageKey: "document.bulk-operation-bad-request",
    statusCode: 400,
  },
  BULK_MOVE_FAILED: {
    message: "Bulk move operation failed",
    messageKey: "document.bulk-move-failed",
    statusCode: 500,
  },
  BULK_ASSIGN_TAGS_FAILED: {
    message: "Bulk tag assignment operation failed",
    messageKey: "document.bulk-assign-tags-failed",
    statusCode: 500,
  },
  DECRYPTION_FAILED: {
    message: "Failed to decrypt document",
    messageKey: "document.decryption-failed",
    statusCode: 500,
  },
  MOVE_FAILED_PERMISSIONS: {
    message: "Failed to to move document due to permissions",
    messageKey: "document.move-failed-permissions",
    statusCode: 500,
  },
  MOVE_FAILED_FOLDER_PERMISSIONS: {
    message: "Failed to to move document due to folder permissions",
    messageKey: "document.move-failed-folder-permissions",
    statusCode: 500,
  },
  INTERNAL_SERVER_ERROR: {
    message: "Internal server error",
    messageKey: "document.internal-server-error",
    statusCode: 500,
  },
  UPLOAD_SESSION_NOT_FOUND: {
    message: "Upload session not found or expired",
    messageKey: "document.upload-session-not-found",
    statusCode: 404,
  },
  UPLOAD_SESSION_EXPIRED: {
    message: "Upload session has expired",
    messageKey: "document.upload-session-expired",
    statusCode: 410,
  },
  UPLOAD_INCOMPLETE: {
    message: "Upload incomplete - not all chunks uploaded",
    messageKey: "document.upload-incomplete",
    statusCode: 400,
  },
  ACTIVITY_LOGS_FAILED: {
    message: "Failed to retrieve activity logs",
    messageKey: "document.activity-logs-failed",
    statusCode: 500,
  },
  ACTIVITY_LOGS_STREAM_FAILED: {
    message: "Failed to establish activity logs stream",
    messageKey: "document.activity-logs-stream-failed",
    statusCode: 500,
  },
  SHARE_FAILED: {
    message: "Failed to share document",
    messageKey: "document.share-failed",
    statusCode: 500,
  },
  CREATE_PUBLIC_SHARE_FAILED: {
    message: "Failed to create public share",
    messageKey: "document.create-public-share-failed",
    statusCode: 500,
  },
  DISABLE_PUBLIC_SHARE_FAILED: {
    message: "Failed to disable public share",
    messageKey: "document.disable-public-share-failed",
    statusCode: 500,
  },
  LIST_PERMISSIONS_FAILED: {
    message: "Failed to list document permissions",
    messageKey: "document.list-permissions-failed",
    statusCode: 500,
  },
  UPDATE_PERMISSION_FAILED: {
    message: "Failed to update document permission",
    messageKey: "document.update-permission-failed",
    statusCode: 500,
  },
  REVOKE_ACCESS_FAILED: {
    message: "Failed to revoke document access",
    messageKey: "document.revoke-access-failed",
    statusCode: 500,
  },
  CANNOT_REVOKE_OWNER_ACCESS: {
    message: "Cannot revoke access from the document owner",
    messageKey: "document.cannot-revoke-owner-access",
    statusCode: 403,
  },
  GET_ACCESS_LOGS_FAILED: {
    message: "Failed to get document access logs",
    messageKey: "document.get-access-logs-failed",
    statusCode: 500,
  },
  TREE_FAILED: {
    message: "Failed to get document tree",
    messageKey: "document.tree-failed",
    statusCode: 500,
  },
  TAGS_NOT_FOUND: {
    message: "One or more tags not found",
    messageKey: "document.tags-not-found",
    statusCode: 400,
  },
  TAG_INPUT_FORMAT_INVALID: {
    message: "Invalid tag input format. Expected string, {id: string}, or {name: string}",
    messageKey: "document.tag-input-format-invalid",
    statusCode: 400,
  },
  MOVE_TARGET_FOLDER_INVALID: {
    message: "Target folder not found or insufficient permissions",
    messageKey: "document.move-target-folder-invalid",
    statusCode: 400,
  },
  MOVE_NO_DOCUMENTS: {
    message: "No documents available to move (insufficient permissions)",
    messageKey: "document.move-no-documents",
    statusCode: 400,
  },
  MOVE_ACCESS_DENIED: {
    message:
      "Access denied: you cannot move this document. Only document owners and users with admin rights can move tenantTables.documents.",
    messageKey: "document.move-access-denied",
    statusCode: 403,
  },
  DUPLICATE_ACCESS_DENIED: {
    message: "Insufficient permissions to duplicate document - admin rights required",
    messageKey: "document.duplicate-access-denied",
    statusCode: 403,
  },
} as const satisfies ErrorCategory;

/**
 * Folder-specific errors
 */
export const DOCUMENT_FOLDER_ERRORS = {
  NOT_FOUND: {
    message: "Folder not found",
    messageKey: "folder.not-found",
    statusCode: 404,
  },
  ACCESS_DENIED: {
    message: "Access denied to folder",
    messageKey: "folder.access-denied",
    statusCode: 401,
  },
  CIRCULAR_REFERENCE: {
    message: "Moving folder would create circular reference",
    messageKey: "folder.circular-reference",
    statusCode: 400,
  },
  MAX_DEPTH_EXCEEDED: {
    message: "Folder depth exceeds maximum allowed (10 levels)",
    messageKey: "folder.max-depth-exceeded",
    statusCode: 400,
  },
  MOVE_FAILED: {
    message: "Failed to move folder",
    messageKey: "folder.move-failed",
    statusCode: 400,
  },
  DELETE_FAILED: {
    message: "Failed to delete folder",
    messageKey: "folder.delete-failed",
    statusCode: 500,
  },
  BULK_DELETE_BAD_REQUEST: {
    message: "Bad request for bulk delete",
    messageKey: "folder.bulk-delete-bad-request",
    statusCode: 400,
  },
  BULK_DELETE_FAILED: {
    message: "Bulk delete operation failed",
    messageKey: "folder.bulk-delete-failed",
    statusCode: 500,
  },
  BULK_ARCHIVE_BAD_REQUEST: {
    message: "Bad request for bulk archive",
    messageKey: "folder.bulk-archive-bad-request",
    statusCode: 400,
  },
  BULK_ARCHIVE_FAILED: {
    message: "Bulk archive operation failed",
    messageKey: "folder.bulk-archive-failed",
    statusCode: 500,
  },
  BULK_RESTORE_FAILED: {
    message: "Bulk restore operation failed",
    messageKey: "folder.bulk-restore-failed",
    statusCode: 500,
  },
  BULK_UNARCHIVE_FAILED: {
    message: "Bulk unarchive operation failed",
    messageKey: "folder.bulk-unarchive-failed",
    statusCode: 500,
  },
  BULK_MOVE_BAD_REQUEST: {
    message: "Bad request for bulk move",
    messageKey: "folder.bulk-move-bad-request",
    statusCode: 400,
  },
  BULK_MOVE_FAILED: {
    message: "Bulk move operation failed",
    messageKey: "folder.bulk-move-failed",
    statusCode: 500,
  },
  SHARE_BAD_REQUEST: {
    message: "Bad request for share",
    messageKey: "folder.share-bad-request",
    statusCode: 400,
  },
  SHARE_INVALID_USERIDS: {
    message: "One or more userIds provided were not valid",
    messageKey: "document-folder.share-invalid-userids",
    statusCode: 400,
  },
  SHARE_FAILED: {
    message: "Share operation failed",
    messageKey: "folder.share-failed",
    statusCode: 500,
  },
  FETCH: {
    message: "Failed to fetch folder list",
    messageKey: "folder.fetch-list-failed",
    statusCode: 500,
  },
  UPDATE_PERMISSION_FAILED: {
    message: "Failed to update user permission",
    messageKey: "folder.update-permission-failed",
    statusCode: 500,
  },
  PUBLIC_SHARE_FAILED: {
    message: "Failed to create public share",
    messageKey: "folder.public-share-failed",
    statusCode: 500,
  },
  PUBLIC_SHARE_NOT_FOUND: {
    message: "Public share not found or expired",
    messageKey: "folder.public-share-not-found",
    statusCode: 404,
  },
  PUBLIC_SHARE_EXPIRED: {
    message: "Public share has expired",
    messageKey: "folder.public-share-expired",
    statusCode: 404,
  },
  PUBLIC_SHARE_ACCESS_DENIED: {
    message: "Access to public share denied",
    messageKey: "folder.public-share-access-denied",
    statusCode: 403,
  },
  PUBLIC_SHARE_PASSWORD_REQUIRED: {
    message: "Password required for this public share",
    messageKey: "folder.public-share-password-required",
    statusCode: 401,
  },
  PUBLIC_SHARE_INVALID_PASSWORD: {
    message: "Invalid password for public share",
    messageKey: "folder.public-share-invalid-password",
    statusCode: 401,
  },
  PUBLIC_SHARE_ACCESS_LIMIT_EXCEEDED: {
    message: "Access limit exceeded for this public share",
    messageKey: "folder.public-share-access-limit-exceeded",
    statusCode: 403,
  },
  CREATE_FAILED: {
    message: "Failed to create folder",
    messageKey: "folder.create-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update folder",
    messageKey: "folder.update-failed",
    statusCode: 500,
  },
  PERMISSION_DENIED: {
    message: "Permission denied to folder",
    messageKey: "folder.permission-denied",
    statusCode: 403,
  },
  DISABLE_PUBLIC_SHARE_FAILED: {
    message: "Failed to disable public share",
    messageKey: "folder.disable-public-share-failed",
    statusCode: 500,
  },
  GET_ACCESS_LOGS_FAILED: {
    message: "Failed to get folder access logs",
    messageKey: "folder.get-access-logs-failed",
    statusCode: 500,
  },
  LIST_PUBLIC_DOCUMENTS_FAILED: {
    message: "Failed to list public documents",
    messageKey: "folder.list-public-documents-failed",
    statusCode: 500,
  },
  FOLDER_SETTINGS_GET_FAILED: {
    message: "Failed to get folder settings",
    messageKey: "folder.folder-settings-get-failed",
    statusCode: 500,
  },
  CANNOT_REVOKE_OWNER_ACCESS: {
    message: "Cannot revoke access from the folder owner",
    messageKey: "folder.cannot-revoke-owner-access",
    statusCode: 403,
  },
  ARCHIVE_FAILED: {
    message: "Failed to archive folder",
    messageKey: "folder.archive-failed",
    statusCode: 500,
  },
  RESTORE_FAILED: {
    message: "Failed to restore folder",
    messageKey: "folder.restore-failed",
    statusCode: 500,
  },
  UNARCHIVE_FAILED: {
    message: "Failed to unarchive folder",
    messageKey: "folder.unarchive-failed",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

export const DOCUMENT_ACCESS = {
  DOCUMENT_ACCESS_LOG_FAILED: {
    message: "Failed to create document access log",
    messageKey: "document.access-log-failed",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

export const DOCUMENT_COMMENT = {
  CREATE_FAILED: {
    message: "Failed to create comment",
    messageKey: "document.comment-create-failed",
    statusCode: 500,
  },
  GET_FAILED: {
    message: "Failed to get comment",
    messageKey: "document.comment-get-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update comment",
    messageKey: "document.comment-update-failed",
    statusCode: 500,
  },
  DELETE_FAILED: {
    message: "Failed to delete comment",
    messageKey: "document.comment-delete-failed",
    statusCode: 500,
  },
  LIST_FAILED: {
    message: "Failed to list comments",
    messageKey: "document.comment-list-failed",
    statusCode: 500,
  },
  RESOLVE_FAILED: {
    message: "Failed to resolve comment",
    messageKey: "document.comment-resolve-failed",
    statusCode: 500,
  },
  UNRESOLVE_FAILED: {
    message: "Failed to unresolve comment",
    messageKey: "document.comment-unresolve-failed",
    statusCode: 500,
  },
  PARENT_NOT_FOUND: {
    message: "Parent comment not found",
    messageKey: "document-comment.parent-not-found",
    statusCode: 404,
  },
} as const satisfies ErrorCategory;

export type DocumentErrorKey = keyof typeof DOCUMENT_ERRORS;
export type DocumentFolderErrorKey = keyof typeof DOCUMENT_FOLDER_ERRORS;
export type DocumentAccessErrorKey = keyof typeof DOCUMENT_ACCESS;
export type DocumentCommentErrorKey = keyof typeof DOCUMENT_COMMENT;
