/**
 * @file middleware/feature-guard.middleware.ts
 * @description Feature Guard middleware
 */
import { eq, HTTPException } from "@deps";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import type { HonoContext, HonoNext } from "@deps";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import type { CachedEnvironmentContext } from "@interfaces/cache.ts";

const ROUTE_FEATURE_MAP: Array<
  { prefix: string; column: "featureDocuments" | "featureEncryption" | "featurePublicSharing" | "featureNotes" | "featureKnowledgeBase" }
> = [
  { prefix: "/api/public/documents", column: "featurePublicSharing" },
  { prefix: "/api/public/notes", column: "featurePublicSharing" },
  { prefix: "/api/documents", column: "featureDocuments" },
  // Note sub-routes must precede the generic /api/notes prefix so they match first.
  { prefix: "/api/notes/collections", column: "featureNotes" },
  { prefix: "/api/notes/tags", column: "featureNotes" },
  { prefix: "/api/notes/attachments", column: "featureNotes" },
  { prefix: "/api/notes", column: "featureNotes" },
  { prefix: "/api/user-encryption", column: "featureEncryption" },
];

/**
 * Fetch the environment context from cache, falling back to DB on miss.
 * Returns the cached/DB value or null if the environment doesn't exist.
 */
async function getEnvironmentContext(
  environmentId: string,
): Promise<CachedEnvironmentContext | null> {
  const cache = await getCache();
  const cached = await cache.get<CachedEnvironmentContext>(
    CACHE_NAMESPACES.ENVIRONMENT.CONTEXT,
    environmentId,
  );

  if (cached) {
    return cached;
  }

  // Cache miss — verify with DB
  const globalDb = getGlobalDB();
  const [env] = await globalDb
    .select({
      status: globalTables.environments.status,
      name: globalTables.environments.name,
      createdAt: globalTables.environments.createdAt,
      updatedAt: globalTables.environments.updatedAt,
      featureDocuments: globalTables.environments.featureDocuments,
      featureEncryption: globalTables.environments.featureEncryption,
      featurePublicSharing: globalTables.environments.featurePublicSharing,
      featureNotes: globalTables.environments.featureNotes,
      featureKnowledgeBase: globalTables.environments.featureKnowledgeBase,
    })
    .from(globalTables.environments)
    .where(eq(globalTables.environments.id, environmentId))
    .limit(1);

  if (!env) {
    return null;
  }

  // Update cache with fresh DB data (24h TTL as safety net)
  await cache.set<CachedEnvironmentContext>(
    CACHE_NAMESPACES.ENVIRONMENT.CONTEXT,
    environmentId,
    env,
    { ttl: 86400 },
  );

  return env;
}

export async function featureGuardMiddleware(c: HonoContext, next: HonoNext) {
  const environmentId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserEnvironmentIdDetails) as string | undefined;

  if (!environmentId) {
    return next();
  }

  const envContext = await getEnvironmentContext(environmentId);

  // ── Suspended environment check (runs before route matching) ──
  if (envContext?.status === "suspended") {
    throw new HTTPException(503, { message: "Environment suspended" });
  }

  // ── Feature flag check ──
  const path = c.req.path;
  const match = ROUTE_FEATURE_MAP.find((entry) => path.startsWith(entry.prefix));
  if (!match) {
    return next();
  }

  // envContext is null only when the environment row doesn't exist in DB —
  // let the request through; downstream handlers will deal with it.
  if (!envContext) {
    return next();
  }

  if (envContext[match.column] === false) {
    throwHttpError("ENVIRONMENT.FEATURE_DISABLED");
  }

  return next();
}

export async function invalidateEnvironmentCache(environmentId: string): Promise<void> {
  const cache = await getCache();
  await cache.delete(CACHE_NAMESPACES.ENVIRONMENT.CONTEXT, environmentId);
}
