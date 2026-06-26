/**
 * @file db/enums/permission.enum.ts
 * @description Permission DB enum definitions
 */
export enum DB_ENUM_PERMISSION_ACCESS_LEVEL {
  READ = "read",
  COMMENT = "comment",
  WRITE = "write",
  DOWNLOAD = "download",
  SHARE = "share",
  ADMIN = "admin",
}

/**
 * Ordered permission levels from least to most permissive.
 * Used for comparing permission levels (replaces numeric >= comparisons).
 */
export const PERMISSION_LEVEL_ORDER: readonly DB_ENUM_PERMISSION_ACCESS_LEVEL[] = [
  DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
  DB_ENUM_PERMISSION_ACCESS_LEVEL.COMMENT,
  DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
  DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
  DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE,
  DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
];

/** Returns true if userLevel meets or exceeds requiredLevel. */
export function permissionLevelMeets(
  userLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL | number,
  requiredLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
): boolean {
  // If userLevel is a number (legacy), convert to enum value via index
  const userEnum = typeof userLevel === "number" ? PERMISSION_LEVEL_ORDER[userLevel] : userLevel;
  if (!userEnum) return false;
  return PERMISSION_LEVEL_ORDER.indexOf(userEnum) >= PERMISSION_LEVEL_ORDER.indexOf(requiredLevel);
}
