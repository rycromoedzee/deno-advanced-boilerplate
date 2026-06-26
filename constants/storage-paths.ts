/**
 * @file constants/storage-paths.ts
 * @description Storage path constants
 */
import { getExtensionFromMimeType } from "@utils/shared/index.ts";

/**
 * Returns the complete storage path for a document given its environment ID, document ID, and MIME type.
 *
 * @param environmentId - The ID of the environment where the document is stored.
 * @param documentId - The unique identifier of the document.
 * @param mimeType - The MIME type of the document, used to determine the file extension.
 * @returns The complete storage path as a string, including the appropriate file extension.
 */
export function completeStoragePathForDocument(
  environmentId: string,
  storageMetadataId: string,
  mimeType: string,
) {
  return `environment-storage/${environmentId}/documents/${storageMetadataId}${getExtensionFromMimeType(mimeType)}`;
}

/**
 * Returns the complete storage path for a document thumbnail.
 *
 * @param environmentId - The ID of the environment where the document is stored.
 * @param storageMetadataId - The unique identifier of the storage metadata.
 * @returns The complete storage path for the thumbnail as a string.
 */
export function completeStoragePathForThumbnail(
  environmentId: string,
  storageMetadataId: string,
): string {
  return `environment-storage/${environmentId}/documents/${storageMetadataId}-thumbnail.jpg`;
}

/**
 * Returns the complete storage path for a note attachment.
 *
 * @param environmentId - The ID of the environment where the attachment is stored.
 * @param attachmentId - The unique identifier of the note attachment.
 * @param mimeType - MIME type of the attachment, used to append the file extension.
 * @returns The complete storage path for the note attachment as a string.
 */
export function completeStoragePathForNoteAttachment(
  environmentId: string,
  attachmentId: string,
  mimeType: string,
): string {
  return `environment-storage/${environmentId}/notes/${attachmentId}${getExtensionFromMimeType(mimeType)}`;
}

/**
 * Returns the complete storage path for a temporary upload chunk.
 *
 * @param environmentId - The ID of the environment where the chunk is stored.
 * @param sessionId - The unique identifier of the upload session.
 * @param chunkIndex - The index of the chunk (0-based).
 * @returns The complete storage path for the chunk as a string.
 */
export function completeStoragePathForChunk(
  environmentId: string,
  sessionId: string,
  chunkIndex: number,
): string {
  return `environment-storage/${environmentId}/temp-chunks/${sessionId}/${chunkIndex}.chunk`;
}

/**
 * Returns the storage path for a thumbnail uploaded before chunked upload completion.
 * The thumbnail is stored temporarily in the session folder alongside the chunks.
 *
 * @param environmentId - The ID of the environment.
 * @param sessionId - The unique identifier of the upload session.
 * @returns The complete storage path for the session thumbnail as a string.
 */
export function completeStoragePathForSessionThumbnail(
  environmentId: string,
  sessionId: string,
): string {
  return `environment-storage/${environmentId}/temp-chunks/${sessionId}/thumbnail.jpg`;
}

/**
 * Returns the complete storage path for an original (unencrypted) upload chunk.
 * These chunks are stored temporarily for hash calculation during chunked upload.
 *
 * @param environmentId - The ID of the environment where the chunk is stored.
 * @param sessionId - The unique identifier of the upload session.
 * @param chunkIndex - The index of the chunk (0-based).
 * @returns The complete storage path for the original chunk as a string.
 */
export function completeStoragePathForOriginalChunk(
  environmentId: string,
  sessionId: string,
  chunkIndex: number,
): string {
  return `environment-storage/${environmentId}/temp-chunks/${sessionId}/${chunkIndex}.original`;
}

/**
 * Returns the storage path for the session folder containing upload chunks.
 * Useful for cleaning up the entire session folder after upload completion.
 *
 * @param environmentId - The ID of the environment where the chunks are stored.
 * @param sessionId - The unique identifier of the upload session.
 * @returns The storage path for the session folder.
 */
export function getSessionFolderPath(
  environmentId: string,
  sessionId: string,
): string {
  return `environment-storage/${environmentId}/temp-chunks/${sessionId}`;
}

/**
 * Extracts the session folder path from a chunk file path.
 *
 * @param chunkPath - Full path to a chunk file (e.g., "environment-storage/123/temp-chunks/abc/0.chunk")
 * @returns The session folder path (e.g., "environment-storage/123/temp-chunks/abc")
 */
export function extractSessionFolderPath(chunkPath: string): string {
  // Pattern: environment-storage/{envId}/temp-chunks/{sessionId}/{chunkFile}
  const match = chunkPath.match(/^(.+\/temp-chunks\/[^/]+)\//);
  if (match) {
    return match[1];
  }
  // Fallback: remove last path segment
  const lastSlash = chunkPath.lastIndexOf("/");
  return lastSlash > 0 ? chunkPath.substring(0, lastSlash) : chunkPath;
}
