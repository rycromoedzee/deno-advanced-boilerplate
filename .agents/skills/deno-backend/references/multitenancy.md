# Multi-Tenancy: DB-per-Account

## Model

- One SQLite/libSQL database per **account** (a.k.a. tenant).
- Many **users** belong to one account.
- Authorization happens BEFORE a DB handle is acquired.
- The tenant identifier is **derived server-side** (session/JWT/API key),
  never read from a user-controlled body or query param.

## Connection lifecycle (pooled per account)

```ts
import { Database } from "../deps.ts";
import { tenantDbPath } from "./db_path.ts";

interface TenantHandle {
  db: Database;
  refCount: number;
}

const pool = new Map<string, TenantHandle>();

// Caller MUST already have verified user ∈ account.
export function withTenantDb<T>(
  accountId: string,
  fn: (db: Database) => T,
): T {
  const handle = acquire(accountId);
  try {
    return fn(handle.db);
  } finally {
    release(accountId);
  }
}

function acquire(accountId: string): TenantHandle {
  let h = pool.get(accountId);
  if (!h) {
    const db = new Database(tenantDbPath(accountId));
    db.exec("PRAGMA journal_mode = WAL;"); // concurrent reads, fast writes
    db.exec("PRAGMA synchronous = NORMAL;"); // safe with WAL, faster
    db.exec("PRAGMA foreign_keys = ON;");
    h = { db, refCount: 0 };
    pool.set(accountId, h);
  }
  h.refCount++;
  return h;
}

function release(accountId: string): void {
  const h = pool.get(accountId);
  if (!h) return;
  if (--h.refCount === 0) {
    // Optionally LRU-evict idle handles to cap open file descriptors.
  }
}
```

## Isolation rules

- The tenant id is derived from the authenticated session, **never** from a
  request body/param the user controls.
- No query may reference another account's table or `ATTACH` another DB.
- Use parameterized queries / prepared statements exclusively — **no
  string-concatenated SQL**.
- A `users` table within each tenant DB scopes data per-user where needed.

## Performance notes

- WAL mode → readers don't block writers.
- Keep prepared statements cached per handle (compile once, reuse).
- Cap the connection pool size; evict idle tenants LRU to bound open FDs.
- Deduplicate concurrent first-opens of the same tenant (inflight map) to avoid
  a thundering herd creating N connections for one tenant.

## Project-Specific Context (verified 2026-06-14)

The model is correct in spirit (DB-per-tenant, many users per tenant) but the
implementation differs from the skill's raw-`@db/sqlite` example.

### Real tenant identity & model
- The tenant key is **`environmentId`** (a CUID2), **not `accountId`**. Many
  users belong to one environment.
- `environmentId` is **derived server-side** from a validated JWT or API key —
  never from a user-controlled body/param (`middleware/auth.ts:206-211` JWT,
  `:265-274` API key, set into context at `:303-306,405-409` and
  `:416-418,459-463`).
- It propagates via `AsyncLocalStorage` (`db/context.ts:1-7`,
  `middleware/tenant-context.middleware.ts:14`).

### Real connection lifecycle (`db/db.ts`)
- Stack is **Drizzle ORM over libSQL** (`drizzle-orm/libsql` + `@libsql/client`),
  not `@db/sqlite`.
- `getTenantDB(environmentId?)` resolves the id from the ALS store and **throws
  if absent** (`db/db.ts:103-108`) — a request cannot open a tenant DB without
  a proven environment context.
- Pooling is done well: per-tenant `Map` pool, **inflight dedup** against
  thundering herd (`:117-129`), capacity-based LRU eviction (`:132-150`,
  cap = `MAX_TENANT_CONNECTIONS`, default 50), and a 60s **idle-eviction
  sweep** at 5-min TTL (`:221-230`).
- Global DB is a singleton (`:60-75`). Local dev uses `file:` URLs; prod
  fetches **encrypted per-tenant Turso credentials** from
  `environmentSqliteRegistry` and decrypts them (`:160-163,188-219`).
- SQLITE_BUSY retry wrapper with exponential backoff (local dev only,
  `:264-290`) and a tracing wrapper (`:316-402`).

### PRAGMAs actually set (`db/db.ts:21-26`)
- `busy_timeout = 5000`, `journal_mode = WAL`, `foreign_keys = ON`.
- Applied **only to `file:` URLs** (local dev); remote Turso connections skip
  them (Turso manages this server-side).

> ⚠️ Current gap: `PRAGMA synchronous = NORMAL` (recommended by the skill for
> WAL) is **not set** (`db/db.ts:23-25` sets only busy_timeout/WAL/foreign_keys).
> Target state: add `synchronous = NORMAL` for local file DBs.

> ⚠️ Current gap: No path-traversal guard / format validation at the tenant
> DB-path construction (`db/db.ts:156`). See `permissions.md` for detail.
> Mitigant: `environmentId` is a CUID2 from auth. Target state: defensive
> validated path builder. **ASSUMPTION — needs confirmation** that
> `environmentId` is never attacker-influenced upstream.

### Already compliant (do not re-litigate)
- `accountId`/`environmentId` is auth-derived, never user-supplied. ✅
- Queries are parameterized via Drizzle; **no `sql.raw` or string-concatenated
  SQL** was found anywhere. ✅
- Connection pooling, inflight dedup, and LRU/idle eviction are implemented and
  bound FD usage. ✅
- Authorization (JWT/API-key validation) happens **before** a tenant DB handle
  is acquired. ✅
