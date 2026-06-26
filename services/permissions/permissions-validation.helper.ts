/**
 * @file services/permissions/permissions-validation.helper.ts
 * @description Shared validation helper for permission operations
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { inArray } from "@deps";

import { throwHttpError } from "@utils/http-exception.ts";
import { traced } from "@services/tracing/index.ts";

/**
 * Result of validating permission names
 */
export interface ValidatedPermissions {
  ids: string[];
  names: string[];
}

/**
 * Validate that all permission names exist in the database.
 * This is a shared helper used by both create and update services.
 *
 * @param names - Array of permission names to validate
 * @returns Array of { id, name } objects for valid permissions
 * @throws AppHttpException if any names are invalid
 */
export async function validatePermissionNames(
  names: string[],
): Promise<Array<{ id: string; name: string }>> {
  if (names.length === 0) return [];

  const db = await getTenantDB();
  const found = await traced(
    "validatePermissionNames",
    "db.query",
    () => {
      return db
        .select({ id: tenantTables.permissions.id, name: tenantTables.permissions.name })
        .from(tenantTables.permissions)
        .where(inArray(tenantTables.permissions.name, names));
    },
  );

  const foundNames = new Set(found.map((p) => p.name));
  const invalid = names.filter((n) => !foundNames.has(n));

  if (invalid.length > 0) {
    throwHttpError(
      "VALIDATION.INVALID_FORMAT",
      `Invalid permission names: ${invalid.join(", ")}`,
    );
  }

  return found;
}
