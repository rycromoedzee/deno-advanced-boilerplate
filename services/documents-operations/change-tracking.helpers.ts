/**
 * @file services/documents-operations/change-tracking.helpers.ts
 * @description Service for tracking document and folder changes
 *
 * This service provides utilities for capturing before/after states of documents
 * and folders, creating change records for audit trails.
 */

import { tenantTables } from "@db/index.ts";

/**
 * Change record structure for audit logs
 */
export interface IChangeRecord {
  field: string;
  previousValue: unknown;
  newValue: unknown;
}

/**
 * Fields to track for document changes
 */
const DOCUMENT_TRACKED_FIELDS = [
  "name",
  "description",
  "folderId",
  "metadata",
  "isArchived",
] as const;

/**
 * Fields to track for folder changes
 */
const FOLDER_TRACKED_FIELDS = [
  "name",
  "description",
  "parentFolderId",
  "color",
  "icon",
  "isPublicShared",
  "publicShareExpiresAt",
  "hasInternalSharing",
  "autoShareNewContent",
  "isArchived",
] as const;

/**
 * Fields to track for permission changes
 */
const PERMISSION_TRACKED_FIELDS = [
  "permissionLevel",
  "isActive",
] as const;

/**
 * Change Tracking Service
 *
 * Provides utilities for capturing and comparing states of entities
 * to generate change records for audit trails. Supports:
 * - Document change tracking
 * - Folder change tracking
 * - Permission change tracking
 */
export class ChangeTrackingService {
  /**
   * Compares two states and generates change records
   *
   * @param previousState - Previous state of the entity
   * @param newState - New state of the entity
   * @param fieldsToTrack - List of fields to track changes for
   * @returns Array of change records
   *
   * @private
   */
  private compareStates<T extends Record<string, unknown>>(
    previousState: Partial<T>,
    newState: Partial<T>,
    fieldsToTrack: readonly string[],
  ): IChangeRecord[] {
    const changes: IChangeRecord[] = [];

    for (const field of fieldsToTrack) {
      const prevValue = previousState[field];
      const newValue = newState[field];

      // Compare values (handle null/undefined as equal)
      if (this.hasChanged(prevValue, newValue)) {
        changes.push({
          field,
          previousValue: this.sanitizeValue(prevValue),
          newValue: this.sanitizeValue(newValue),
        });
      }
    }

    return changes;
  }

  /**
   * Determines if a value has changed (handles null/undefined specially)
   *
   * @param prevValue - Previous value
   * @param newValue - New value
   * @returns True if values are different
   *
   * @private
   */
  private hasChanged(prevValue: unknown, newValue: unknown): boolean {
    // Treat null and undefined as equal
    if (
      (prevValue === null || prevValue === undefined) &&
      (newValue === null || newValue === undefined)
    ) {
      return false;
    }

    // For objects and arrays, use JSON comparison
    if (
      typeof prevValue === "object" && prevValue !== null &&
      typeof newValue === "object" && newValue !== null
    ) {
      return JSON.stringify(prevValue) !== JSON.stringify(newValue);
    }

    // For primitives, use strict equality
    return prevValue !== newValue;
  }

  /**
   * Sanitizes values for storage (truncate large strings, handle special types)
   *
   * @param value - Value to sanitize
   * @returns Sanitized value
   *
   * @private
   */
  private sanitizeValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    // Truncate very long strings
    if (typeof value === "string" && value.length > 500) {
      return value.substring(0, 500) + "... (truncated)";
    }

    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString();
    }

    return value;
  }

  /**
   * Tracks changes for a document update operation
   *
   * @param previousDocument - Previous state of the document
   * @param updatedDocument - Updated state of the document
   * @returns Array of change records
   *
   * @example
   * ```typescript
   * const service = new ChangeTrackingService();
   * const changes = service.trackDocumentChanges(oldDoc, newDoc);
   * // Returns: [{ field: "name", previousValue: "Old", newValue: "New" }]
   * ```
   */
  trackDocumentChanges(
    previousDocument: Partial<typeof tenantTables.documents.$inferSelect>,
    updatedDocument: Partial<typeof tenantTables.documents.$inferSelect>,
  ): IChangeRecord[] {
    return this.compareStates(
      previousDocument,
      updatedDocument,
      DOCUMENT_TRACKED_FIELDS,
    );
  }

  /**
   * Tracks changes for a folder update operation
   *
   * @param previousFolder - Previous state of the folder
   * @param updatedFolder - Updated state of the folder
   * @returns Array of change records
   */
  trackFolderChanges(
    previousFolder: Partial<typeof tenantTables.documentFolders.$inferSelect>,
    updatedFolder: Partial<typeof tenantTables.documentFolders.$inferSelect>,
  ): IChangeRecord[] {
    return this.compareStates(
      previousFolder,
      updatedFolder,
      FOLDER_TRACKED_FIELDS,
    );
  }

  /**
   * Tracks changes for a document move operation
   *
   * @param previousFolderId - Previous folder ID
   * @param newFolderId - New folder ID
   * @returns Array of change records
   */
  trackDocumentMove(
    previousFolderId: string | null,
    newFolderId: string | null,
  ): IChangeRecord[] {
    if (this.hasChanged(previousFolderId, newFolderId)) {
      return [{
        field: "folderId",
        previousValue: previousFolderId,
        newValue: newFolderId,
      }];
    }
    return [];
  }

  /**
   * Tracks changes for permission updates
   *
   * @param previousPermission - Previous permission state
   * @param updatedPermission - Updated permission state
   * @returns Array of change records
   */
  trackPermissionChanges(
    previousPermission: Partial<typeof tenantTables.documentFoldersSharedUsers.$inferSelect>,
    updatedPermission: Partial<typeof tenantTables.documentFoldersSharedUsers.$inferSelect>,
  ): IChangeRecord[] {
    return this.compareStates(
      previousPermission,
      updatedPermission,
      PERMISSION_TRACKED_FIELDS,
    );
  }
}

/**
 * Singleton instance
 */
let changeTrackingService: ChangeTrackingService | null = null;

/**
 * Gets or creates the change tracking service singleton
 */
export function getChangeTrackingService(): ChangeTrackingService {
  if (!changeTrackingService) {
    changeTrackingService = new ChangeTrackingService();
  }
  return changeTrackingService;
}
