/**
 * @file interfaces/encryption.ts
 * @description Encryption service interfaces
 */

import { SQLiteTable } from "@deps";
import type { IHashingContext } from "@utils/text/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { JWT_TOKEN_TYPES } from "@constants/token.ts";

/**
 * Cache adapter interface for PermissionService.
 */
export interface IPermissionCacheAdapter {
  getPermission(
    resourceId: string,
    userId: string,
  ): Promise<DB_ENUM_PERMISSION_ACCESS_LEVEL | null | undefined>;
  cachePermission(
    resourceId: string,
    userId: string,
    level: DB_ENUM_PERMISSION_ACCESS_LEVEL | null,
  ): Promise<void>;
  batchGetPermissions(
    resourceIds: string[],
    userId: string,
  ): Promise<Map<string, DB_ENUM_PERMISSION_ACCESS_LEVEL | null | undefined>>;
  batchCachePermissions(
    entries: Array<{
      resourceId: string;
      userId: string;
      permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL | null;
    }>,
  ): Promise<void>;
  invalidatePermissions(resourceId: string): Promise<void>;
  batchInvalidatePermissions(resourceIds: string[]): Promise<void>;
}

/**
 * A Drizzle SQLite table accessed by a dynamic column name (e.g. `table[resourceIdColumn]`).
 *
 * The `any` index value is a deliberate, contained escape-hatch: Drizzle's per-column
 * value-type generic cannot be preserved through a runtime string index, and `.from()` /
 * `eq()` overloads do not resolve for a generic table parameter (documented drizzle-orm
 * generics friction). Centralising the single `any` here lets every caller inherit one
 * typed boundary instead of re-declaring `any` at each call site.
 */
// deno-lint-ignore no-explicit-any
export type DynamicColumnTable = SQLiteTable & Record<string, any>;

/**
 * Configuration for table-specific encryption operations
 */
export interface IEncryptionTableConfig {
  tableName: DynamicColumnTable;
  /** Column name for the resource ID (e.g., 'fileId', 'documentId') */
  resourceIdColumn: string;
}

/**
 * Encryption result for data operations
 */
export interface EncryptionResult {
  encryptedData: Uint8Array;
  encryptedMasterKey: Uint8Array;
}

/**
 * Encryption context types
 */
export type EncryptionContext =
  | "USER_DATA"
  | "FILE_STORAGE"
  | "USER_NOTES"
  | "SENSITIVE_DATA"
  | string;

/**
 * Encryption key types
 */
export interface EncryptionKeys {
  masterKey: string;
  dataMasterKey: string;
  userMasterKey: string;
}

/**
 * Text encryption result interface for session-integrated operations
 */
export interface TextEncryptionResult {
  encryptedText: Uint8Array;
  encryptedDataMasterKey: Uint8Array;
  encryptionType: IHashingContext;
  userId: string;
}

/**
 * Configuration interface for text encryption operations
 */
export interface TextEncryptionConfig {
  encryptionType?: IHashingContext;
  audience?: string;
  tokenType?: JWT_TOKEN_TYPES;
}

/**
 * Configuration interface for file encryption operations
 */
export interface FileEncryptionConfig {
  encryptionType?: IHashingContext;
  chunkSize?: number;
}

/**
 * Permission check result interface
 */
export interface PermissionCheckResult {
  /** Whether the user has the required permission */
  hasPermission: boolean;
  /** User's current permission level */
  currentLevel?: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  /** Error message if permission denied */
  errorMessage?: string;
}
