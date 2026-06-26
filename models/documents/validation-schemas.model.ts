/**
 * @file models/documents/validation-schemas.model.ts
 * @description Enhanced validation schemas for document operations
 *
 * Provides comprehensive validation with security constraints:
 * - File size limits
 * - Array size limits for bulk operations
 * - String length constraints
 * - Type validation
 */

import { z } from "@deps";
import { SCHEMA_VALIDATION_METADATA } from "./common.model.ts";
import { SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP } from "../shared.model.ts";
import { ALL_ALLOWED_MIME_TYPES, FILE_UPLOAD_CONSTRAINTS } from "@constants/documents/file-upload.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";
import { STRING_LENGTH_CONSTRAINTS } from "@constants/validation/string-lengths.ts";
import { NUMERIC_LIMITS } from "@constants/validation/numeric-limits.ts";
import { REGEX_ERROR_MESSAGES, REGEX_PATTERNS } from "@constants/validation/regex-patterns.ts";
import { PERMISSION_CONSTRAINTS } from "@constants/validation/permissions.ts";
import { PASSWORD_CONSTRAINTS } from "@constants/auth.ts";
import { UI_DEFAULTS } from "@constants/ui.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

/**
 * @deprecated Use individual constants from @constants instead.
 * This object is kept for backward compatibility but will be removed in a future version.
 */
export { FILE_UPLOAD_CONSTRAINTS };

/**
 * @deprecated Use BULK_OPERATION_CONSTRAINTS from @constants/documents/bulk-operations instead.
 * This export is kept for backward compatibility but will be removed in a future version.
 */
export { BULK_OPERATION_CONSTRAINTS };

/**
 * Document upload validation schema
 */
export const SCHEMA_VALIDATION_DOCUMENT_UPLOAD = z.object({
  name: z.string()
    .min(1, withKey("documents.name-required", "Document name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("documents.name-max-length", `Name must be ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters or less`),
    ),
  description: z.string()
    .max(
      STRING_LENGTH_CONSTRAINTS.DESCRIPTION_STANDARD_MAX,
      withKey(
        "documents.description-max-length",
        `Description must be ${STRING_LENGTH_CONSTRAINTS.DESCRIPTION_STANDARD_MAX} characters or less`,
      ),
    )
    .optional()
    .nullable(),
  folderId: z.string().optional().nullable(),
  mimeType: z.string()
    .refine(
      (type) => ALL_ALLOWED_MIME_TYPES.includes(type as typeof ALL_ALLOWED_MIME_TYPES[number]),
      { message: withKey("documents.file-type-not-allowed", "File type not allowed") },
    ),
  fileSize: z.number()
    .int()
    .positive()
    .max(
      NUMERIC_LIMITS.MAX_FILE_SIZE_BYTES,
      withKey("documents.file-size-exceeded", `File size must be less than ${NUMERIC_LIMITS.MAX_FILE_SIZE_GB}GB`),
    ),
  tags: z.array(z.string())
    .max(
      NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT,
      withKey("documents.tags-limit-exceeded", `Maximum ${NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT} tags allowed`),
    )
    .default([]),
  metadata: SCHEMA_VALIDATION_METADATA.default({}),
});

export type IDocumentUploadValidation = z.infer<typeof SCHEMA_VALIDATION_DOCUMENT_UPLOAD>;

/**
 * Document move validation schema
 */
export const SCHEMA_VALIDATION_DOCUMENT_MOVE = z.object({
  targetFolderId: z.string().nullable(),
});

export type IDocumentMoveValidation = z.infer<typeof SCHEMA_VALIDATION_DOCUMENT_MOVE>;

/**
 * Bulk operation validation schema
 */
export const SCHEMA_VALIDATION_BULK_OPERATION = z.object({
  documentIds: z.array(z.string())
    .min(
      BULK_OPERATION_CONSTRAINTS.MIN_DOCUMENTS,
      withKey("documents.bulk-min-documents", `At least ${BULK_OPERATION_CONSTRAINTS.MIN_DOCUMENTS} document required`),
    )
    .max(
      BULK_OPERATION_CONSTRAINTS.MAX_DOCUMENTS,
      withKey("documents.bulk-max-documents", `Maximum ${BULK_OPERATION_CONSTRAINTS.MAX_DOCUMENTS} documents allowed per operation`),
    ),
});

export type IBulkOperationValidation = z.infer<typeof SCHEMA_VALIDATION_BULK_OPERATION>;

/**
 * Bulk move validation schema
 */
export const SCHEMA_VALIDATION_BULK_MOVE = SCHEMA_VALIDATION_BULK_OPERATION.extend({
  targetFolderId: z.string().nullable(),
});

export type IBulkMoveValidation = z.infer<typeof SCHEMA_VALIDATION_BULK_MOVE>;

/**
 * Bulk archive validation schema
 */
export const SCHEMA_VALIDATION_BULK_ARCHIVE = SCHEMA_VALIDATION_BULK_OPERATION.extend({
  isArchived: z.boolean(),
});

export type IBulkArchiveValidation = z.infer<typeof SCHEMA_VALIDATION_BULK_ARCHIVE>;

/**
 * Bulk tag assignment validation schema
 */
export const SCHEMA_VALIDATION_BULK_TAG_ASSIGNMENT = SCHEMA_VALIDATION_BULK_OPERATION.extend({
  tagIds: z.array(z.string())
    .min(1, withKey("documents.tag-required", "At least one tag required"))
    .max(
      NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT,
      withKey("documents.tags-limit-exceeded", `Maximum ${NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT} tags allowed`),
    ),
});

export type IBulkTagAssignmentValidation = z.infer<typeof SCHEMA_VALIDATION_BULK_TAG_ASSIGNMENT>;

/**
 * Folder creation validation schema
 */
export const SCHEMA_VALIDATION_FOLDER_CREATE = z.object({
  name: z.string()
    .min(STRING_LENGTH_CONSTRAINTS.NAME_MIN, withKey("folders.name-required", "Folder name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("folders.name-max-length", `Name must be ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters or less`),
    ),
  description: z.string()
    .max(
      STRING_LENGTH_CONSTRAINTS.DESCRIPTION_STANDARD_MAX,
      withKey(
        "folders.description-max-length",
        `Description must be ${STRING_LENGTH_CONSTRAINTS.DESCRIPTION_STANDARD_MAX} characters or less`,
      ),
    )
    .optional()
    .nullable(),
  parentFolderId: z.string().optional().nullable(),
  color: z.string()
    .regex(REGEX_PATTERNS.HEX_COLOR, REGEX_ERROR_MESSAGES.HEX_COLOR)
    .default(UI_DEFAULTS.DEFAULT_FOLDER_COLOR),
  icon: z.string()
    .max(
      STRING_LENGTH_CONSTRAINTS.ICON_IDENTIFIER_MAX,
      withKey("folders.icon-max-length", `Icon identifier must be ${STRING_LENGTH_CONSTRAINTS.ICON_IDENTIFIER_MAX} characters or less`),
    )
    .default(UI_DEFAULTS.DEFAULT_FOLDER_ICON),
});

export type IFolderCreateValidation = z.infer<typeof SCHEMA_VALIDATION_FOLDER_CREATE>;

/**
 * Folder update validation schema
 */
export const SCHEMA_VALIDATION_FOLDER_UPDATE = z.object({
  name: z.string()
    .min(STRING_LENGTH_CONSTRAINTS.NAME_MIN, withKey("folders.name-required", "Folder name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("folders.name-max-length", `Name must be ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters or less`),
    )
    .optional(),
  description: z.string()
    .max(
      STRING_LENGTH_CONSTRAINTS.DESCRIPTION_STANDARD_MAX,
      withKey(
        "folders.description-max-length",
        `Description must be ${STRING_LENGTH_CONSTRAINTS.DESCRIPTION_STANDARD_MAX} characters or less`,
      ),
    )
    .optional()
    .nullable(),
  color: z.string()
    .regex(REGEX_PATTERNS.HEX_COLOR, REGEX_ERROR_MESSAGES.HEX_COLOR)
    .optional(),
  icon: z.string()
    .max(
      STRING_LENGTH_CONSTRAINTS.ICON_IDENTIFIER_MAX,
      withKey("folders.icon-max-length", `Icon identifier must be ${STRING_LENGTH_CONSTRAINTS.ICON_IDENTIFIER_MAX} characters or less`),
    )
    .optional(),
});

export type IFolderUpdateValidation = z.infer<typeof SCHEMA_VALIDATION_FOLDER_UPDATE>;

/**
 * Sharing validation schema
 */
export const SCHEMA_VALIDATION_SHARING = z.object({
  userIds: z.array(z.string())
    .min(1, withKey("sharing.user-required", "At least one user required"))
    .max(
      NUMERIC_LIMITS.MAX_USERS_PER_FOLDER_SHARE,
      withKey("sharing.users-limit-exceeded", `Maximum ${NUMERIC_LIMITS.MAX_USERS_PER_FOLDER_SHARE} users allowed per sharing operation`),
    ),
  permissionLevel: z.number()
    .int()
    .min(
      PERMISSION_CONSTRAINTS.INTERNAL_MIN,
      withKey(
        "sharing.permission-invalid",
        `Permission level must be between ${PERMISSION_CONSTRAINTS.INTERNAL_MIN} and ${PERMISSION_CONSTRAINTS.INTERNAL_MAX}`,
      ),
    )
    .max(
      PERMISSION_CONSTRAINTS.INTERNAL_MAX,
      withKey(
        "sharing.permission-invalid",
        `Permission level must be between ${PERMISSION_CONSTRAINTS.INTERNAL_MIN} and ${PERMISSION_CONSTRAINTS.INTERNAL_MAX}`,
      ),
    ),
  notifyUsers: z.boolean().default(true),
});

export type ISharingValidation = z.infer<typeof SCHEMA_VALIDATION_SHARING>;

/**
 * Public share creation validation schema
 */
export const SCHEMA_VALIDATION_PUBLIC_SHARE = z.object({
  expiresAt: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP.refine(
    (val) => !val || val > Date.now(),
    { message: withKey("sharing.expiration-future", "Expiration date must be in the future") },
  ),
  password: z.string()
    .min(
      PASSWORD_CONSTRAINTS.SHARE_MIN_LENGTH,
      withKey("sharing.password-min-length", `Password must be at least ${PASSWORD_CONSTRAINTS.SHARE_MIN_LENGTH} characters`),
    )
    .max(
      PASSWORD_CONSTRAINTS.SHARE_MAX_LENGTH,
      withKey("sharing.password-max-length", `Password must be ${PASSWORD_CONSTRAINTS.SHARE_MAX_LENGTH} characters or less`),
    )
    .optional()
    .nullable(),
  permissionLevel: z.number()
    .int()
    .min(
      PERMISSION_CONSTRAINTS.PUBLIC_MIN,
      withKey(
        "sharing.public-permission-invalid",
        `Permission level must be between ${PERMISSION_CONSTRAINTS.PUBLIC_MIN} and ${PERMISSION_CONSTRAINTS.PUBLIC_MAX} for public shares`,
      ),
    )
    .max(
      PERMISSION_CONSTRAINTS.PUBLIC_MAX,
      withKey(
        "sharing.public-permission-invalid",
        `Permission level must be between ${PERMISSION_CONSTRAINTS.PUBLIC_MIN} and ${PERMISSION_CONSTRAINTS.PUBLIC_MAX} for public shares`,
      ),
    ),
});

export type IPublicShareValidation = z.infer<typeof SCHEMA_VALIDATION_PUBLIC_SHARE>;

/**
 * Permission update validation schema
 */
export const SCHEMA_VALIDATION_PERMISSION_UPDATE = z.object({
  permissionLevel: z.number()
    .int()
    .min(
      PERMISSION_CONSTRAINTS.INTERNAL_MIN,
      withKey(
        "sharing.permission-invalid",
        `Permission level must be between ${PERMISSION_CONSTRAINTS.INTERNAL_MIN} and ${PERMISSION_CONSTRAINTS.INTERNAL_MAX}`,
      ),
    )
    .max(
      PERMISSION_CONSTRAINTS.INTERNAL_MAX,
      withKey(
        "sharing.permission-invalid",
        `Permission level must be between ${PERMISSION_CONSTRAINTS.INTERNAL_MIN} and ${PERMISSION_CONSTRAINTS.INTERNAL_MAX}`,
      ),
    ),
});

export type IPermissionUpdateValidation = z.infer<typeof SCHEMA_VALIDATION_PERMISSION_UPDATE>;
