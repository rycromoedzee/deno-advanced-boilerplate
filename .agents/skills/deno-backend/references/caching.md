# Caching

## Cardinal rule

Cache keys are namespaced by the tenant id. A cache hit for tenant A must be
**structurally impossible** to return to tenant B. If a key can be constructed
without the tenant id, it is a cross-tenant bleed waiting to happen.

## Layered approach

1. **Prepared-statement cache** — per tenant handle, compile once, reuse.
2. **Read-model cache** — keyed `${tenantId}:${queryId}:${argsHash}`.
3. **HTTP layer** — `Cache-Control: private` for tenant data; never `public`.

## Example

```ts
import { LruCache } from "../deps.ts";

const cache = new LruCache<string, unknown>(10_000);

function cacheKey(accountId: string, queryId: string, args: string): string {
  return `${accountId}:${queryId}:${args}`;
}

export function readCached<T>(
  accountId: string,
  queryId: string,
  args: string,
  load: () => T,
): T {
  const key = cacheKey(accountId, queryId, args);
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  const value = load();
  cache.set(key, value);
  return value;
}

// Invalidate the whole tenant namespace on any write to that tenant.
export function invalidateTenant(accountId: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${accountId}:`)) cache.delete(key);
  }
}
```

## Rules

- Every write transaction calls `invalidateTenant(accountId)` (or a narrower,
  tenant-prefixed invalidation) as part of the write's completion.
- Never cache across the tenant boundary. The tenant id is the **first**
  segment of every tenant-scoped key.
- Prefer time-bounded **and** write-invalidated caching over time-only TTLs for
  correctness; a TTL is a backstop, not a substitute for invalidation.
- Never let a missing tenant id silently fall back to a shared sentinel (e.g.
  `"unknown"`) — throw instead.

## Project-Specific Context (verified 2026-06-14)

The skill's single-`LruCache` example is not the real design. This project has
a **3-tier cache** behind a process-wide singleton.

### Real caching layers
- Tiers: **L1 in-memory** (`services/cache/memory-cache.provider.ts`), **L2
  Redis** with Pub/Sub cache bus (`redis-cache.provider.ts`), **L2 fallback
  Deno KV** (`deno-kv-cache.provider.ts`), orchestrated by
  `MultiTierCacheProvider` (`multi-tier-cache.provider.ts`).
- Public facade is a **single global singleton** `getCache()`
  (`services/cache/index.ts:74`) shared across **all** tenants.
- Physical key format = `` `${namespace}:${key}` `` (`services/cache/cache-utils.ts:37-39`).
  Namespaces are enumerated in `interfaces/cache.ts:257-...`
  (e.g. `PERMISSIONS.ALL = "permissions"`, `PERMISSIONS.ADMIN = "user_admin_status"`).
- HTTP layer correctly uses `Cache-Control: private` for password-protected
  resources (`handlers/documents-public/stream-public-document.handler.ts:227`).
- No Drizzle prepared-statement cache layer was found. **ASSUMPTION — needs
  confirmation** that none exists.

### Tenant-namespaced keys (correct)
- `getCachedUserAdminStatus` →
  `` `${resolvedEnvironmentId ?? "unknown"}:${userId}` ``
  (`services/permissions/permissions-helper.service.ts:162`).

> ⚠️ Current gap (🔴 cross-tenant bleed): The cache is one global singleton,
> yet several permission/document keys **omit `environmentId`**:
> - Permission-ID cache: key = bare `permissionName`, namespace
>   `PERMISSIONS.ALL` (`permissions-helper.service.ts:404-406`). Permission
>   *names* are shared across tenants but their per-tenant-DB *ids* differ —
>   the first tenant to populate serves its id to every other tenant. This is
>   the strongest concrete bleed vector.
> - `hasPermission`: key = `` `${entityId}:${permissionName}` `` (`:320`).
> - Document/folder permission caches: keys `` `${documentId}:${userId}` `` /
>   `` `${folderId}:${userId}` `` (`services/documents-cache/cache.service.ts:157,572`).
> These are safe only if every entity id is globally unique. **ASSUMPTION —
> needs confirmation** that `userId`/`documentId`/`folderId`/`groupId` are
> globally-unique CUID2/NanoID (id generators in `utils/database/id-generation/`
> suggest yes, but permission *ids* are per-tenant-DB rows). Target state: every
> tenant-scoped cache key is prefixed with `environmentId`.

> ⚠️ Current gap: `getCachedUserAdminStatus`'s `?? "unknown"` fallback
> (`permissions-helper.service.ts:162`) collapses tenant separation if
> `environmentId` is unresolved — any caller in that state shares an
> `unknown:<userId>` slot. Reachable by signature (callers in
> `middleware/auth.ts:98,312` currently pass concrete values). Target state:
> throw rather than fall back to `"unknown"`.

> ⚠️ Current gap: Invalidation is **post-write and non-transactional** —
> manual `await` calls after the DB write (e.g.
> `services/permissions/permissions-update.service.ts:355-358`), not bound to
> the write transaction/commit. A crash or concurrent read in the gap serves
> stale data until TTL (USER_PERMISSION_TTL = 8h,
> `permissions-helper.service.ts:65`). Target state: tie invalidation to the
> write transaction (outbox/commit hook) and/or shorten TTLs.

### Already compliant (do not re-litigate)
- `getCachedUserAdminStatus` IS tenant-namespaced. ✅
- HTTP `Cache-Control: private` is used for protected resources. ✅
- L1↔L2 coherence is maintained via Redis Pub/Sub invalidation
  (`multi-tier-cache.provider.ts:69-81`). ✅
