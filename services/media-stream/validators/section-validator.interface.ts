/**
 * @file services/media-stream/validators/section-validator.interface.ts
 * @description Section Validator interface for media stream validators services
 */
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";

/**
 * Interface for section-specific access validation
 * Each section implements this to provide custom permission logic
 */
export interface ISectionAccessValidator {
  /**
   * Validates if user has access to stream the resource
   * @param resourceId - The resource ID (e.g., document ID, todo ID)
   * @param userId - The authenticated user ID
   * @param requiredPermission - Minimum permission level required
   * @returns Storage metadata ID if access granted, null if denied
   */
  validateAccess(
    resourceId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<string | null>;

  /**
   * Gets the storage metadata ID for the resource
   * Used for direct lookups when permission is already validated
   * @param resourceId - The resource ID
   * @returns Storage metadata ID or null if not found
   */
  getStorageMetadataId(resourceId: string): Promise<string | null>;

  /**
   * Section identifier
   */
  readonly sectionName: string;
}
