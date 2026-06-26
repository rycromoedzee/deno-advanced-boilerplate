/**
 * @file middleware/super-admin-guard.middleware.ts
 * @description Super Admin Guard middleware
 */
import type { HonoContext, HonoNext } from "@deps";
import { eq, HTTPException } from "@deps";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { getGlobalDB, globalTables } from "@db/db.ts";

/**
 * Super Admin Guard Middleware
 *
 * Protects /api/super-admin/* routes.
 * Requires the user to be authenticated (via authMiddleware) AND have isSuperAdmin: true.
 * Returns 403 if not a super admin.
 */
export async function superAdminGuardMiddleware(c: HonoContext, next: HonoNext) {
  const userId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails);

  if (!userId) {
    throw new HTTPException(401, { message: "Not authenticated" });
  }

  const globalDb = getGlobalDB();
  const [user] = await globalDb
    .select({ isSuperAdmin: globalTables.users.isSuperAdmin })
    .from(globalTables.users)
    .where(eq(globalTables.users.id, userId))
    .limit(1);

  if (!user || !user.isSuperAdmin) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  c.set("isSuperAdmin", true);
  c.set("superAdminUserId", userId);

  return await next();
}
