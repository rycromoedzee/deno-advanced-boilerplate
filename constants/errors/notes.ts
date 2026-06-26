/**
 * @file constants/errors/notes.ts
 * @description Notes error message constants
 */
/**
 * Notes Management Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Note-specific errors
 */
export const NOTE_ERRORS = {
  NOT_FOUND: {
    message: "Note not found",
    messageKey: "note.not-found",
    statusCode: 404,
  },
  ACCESS_DENIED: {
    message: "Access denied to note",
    messageKey: "note.access-denied",
    statusCode: 403,
  },
  BAD_REQUEST: {
    message: "Bad request",
    messageKey: "note.bad-request",
    statusCode: 400,
  },
  CREATE_FAILED: {
    message: "Failed to create note",
    messageKey: "note.create-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update note",
    messageKey: "note.update-failed",
    statusCode: 500,
  },
  DELETE_FAILED: {
    message: "Failed to delete note",
    messageKey: "note.delete-failed",
    statusCode: 500,
  },
  ARCHIVE_FAILED: {
    message: "Failed to archive note",
    messageKey: "note.archive-failed",
    statusCode: 500,
  },
  RESTORE_FAILED: {
    message: "Failed to restore note",
    messageKey: "note.restore-failed",
    statusCode: 500,
  },
  LIST_FAILED: {
    message: "Failed to list notes",
    messageKey: "note.list-failed",
    statusCode: 500,
  },
  INTERNAL_SERVER_ERROR: {
    message: "Internal server error",
    messageKey: "note.internal-server-error",
    statusCode: 500,
  },
  ENCRYPTION_KEY_NOT_FOUND: {
    message: "Encryption key not found for note",
    messageKey: "note.encryption-key-not-found",
    statusCode: 500,
  },
  SHARE_FAILED: {
    message: "Failed to share note",
    messageKey: "note.share-failed",
    statusCode: 500,
  },
  REVOKE_ACCESS_FAILED: {
    message: "Failed to revoke note access",
    messageKey: "note.revoke-access-failed",
    statusCode: 500,
  },
  CANNOT_REVOKE_OWNER_ACCESS: {
    message: "Cannot revoke access from the note owner",
    messageKey: "note.cannot-revoke-owner-access",
    statusCode: 403,
  },
  LIST_PERMISSIONS_FAILED: {
    message: "Failed to list note permissions",
    messageKey: "note.list-permissions-failed",
    statusCode: 500,
  },
  UPDATE_PERMISSION_FAILED: {
    message: "Failed to update note permission",
    messageKey: "note.update-permission-failed",
    statusCode: 500,
  },
  SHARE_BAD_REQUEST: {
    message: "Bad request for sharing note",
    messageKey: "note.share-bad-request",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

/**
 * Note collection errors
 */
export const NOTE_COLLECTION_ERRORS = {
  NOT_FOUND: {
    message: "Note collection not found",
    messageKey: "note-collection.not-found",
    statusCode: 404,
  },
  ACCESS_DENIED: {
    message: "Access denied to note collection",
    messageKey: "note-collection.access-denied",
    statusCode: 403,
  },
  CREATE_FAILED: {
    message: "Failed to create note collection",
    messageKey: "note-collection.create-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update note collection",
    messageKey: "note-collection.update-failed",
    statusCode: 500,
  },
  DELETE_FAILED: {
    message: "Failed to delete note collection",
    messageKey: "note-collection.delete-failed",
    statusCode: 500,
  },
  ARCHIVE_FAILED: {
    message: "Failed to archive note collection",
    messageKey: "note-collection.archive-failed",
    statusCode: 500,
  },
  RESTORE_FAILED: {
    message: "Failed to restore note collection",
    messageKey: "note-collection.restore-failed",
    statusCode: 500,
  },
  SHARE_FAILED: {
    message: "Failed to share note collection",
    messageKey: "note-collection.share-failed",
    statusCode: 500,
  },
  FETCH_FAILED: {
    message: "Failed to fetch note collections",
    messageKey: "note-collection.fetch-failed",
    statusCode: 500,
  },
  INTERNAL_SERVER_ERROR: {
    message: "Internal server error",
    messageKey: "note-collection.internal-server-error",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

/**
 * Note attachment errors
 */
export const NOTE_ATTACHMENT_ERRORS = {
  NOT_FOUND: {
    message: "Note attachment not found",
    messageKey: "note-attachment.not-found",
    statusCode: 404,
  },
  ACCESS_DENIED: {
    message: "Access denied to note attachment",
    messageKey: "note-attachment.access-denied",
    statusCode: 403,
  },
  UPLOAD_FAILED: {
    message: "Failed to upload note attachment",
    messageKey: "note-attachment.upload-failed",
    statusCode: 500,
  },
  INVALID_FILE_TYPE: {
    message: "Invalid file type for note attachment",
    messageKey: "note-attachment.invalid-file-type",
    statusCode: 400,
  },
  FILE_TOO_LARGE: {
    message: "Note attachment file size exceeds maximum allowed",
    messageKey: "note-attachment.file-too-large",
    statusCode: 413,
  },
  DELETE_FAILED: {
    message: "Failed to delete note attachment",
    messageKey: "note-attachment.delete-failed",
    statusCode: 500,
  },
  STREAM_FAILED: {
    message: "Failed to stream note attachment",
    messageKey: "note-attachment.stream-failed",
    statusCode: 500,
  },
  INTERNAL_SERVER_ERROR: {
    message: "Internal server error",
    messageKey: "note-attachment.internal-server-error",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

/**
 * Note tag errors
 */
export const NOTE_TAG_ERRORS = {
  NOT_FOUND: {
    message: "Note tag not found",
    messageKey: "note-tag.not-found",
    statusCode: 404,
  },
  CREATE_FAILED: {
    message: "Failed to create note tag",
    messageKey: "note-tag.create-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update note tag",
    messageKey: "note-tag.update-failed",
    statusCode: 500,
  },
  DELETE_FAILED: {
    message: "Failed to delete note tag",
    messageKey: "note-tag.delete-failed",
    statusCode: 500,
  },
  ALREADY_EXISTS: {
    message: "Note tag already exists",
    messageKey: "note-tag.already-exists",
    statusCode: 409,
  },
} as const satisfies ErrorCategory;

export type NoteErrorKey = keyof typeof NOTE_ERRORS;
export type NoteCollectionErrorKey = keyof typeof NOTE_COLLECTION_ERRORS;
export type NoteAttachmentErrorKey = keyof typeof NOTE_ATTACHMENT_ERRORS;
export type NoteTagErrorKey = keyof typeof NOTE_TAG_ERRORS;
