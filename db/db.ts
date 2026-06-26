/**
 * @file db/db.ts
 * @description Database client setup (libSQL/drizzle) with global+tenant schema wiring
 */
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { type Client as LibSQLClient, createClient as createWebClient } from "@libsql/client";
import { createClient as createNodeClient } from "@libsql/client/node";
import * as globalSchema from "./schema/global/index.ts";
// Circular import (db → tracing → span-collector → @db/index → db) is safe at
// runtime because span-collector only touches @db/index inside function bodies,
// not at module init time. Do not hoist any span-collector access to init.
import { getTraceContext } from "@services/tracing/trace-context.service.ts";

function createClient(config: { url: string; authToken?: string }): LibSQLClient {
  if (config.url.startsWith("file:")) {
    return createNodeClient(config);
  }
  return createWebClient(config);
}

/**
 * Sets SQLite pragmas for concurrent write handling on local file-based DBs.
 * Must be awaited before the client is used for any queries/transactions.
 */
async function ensureLocalPragmas(client: LibSQLClient, url: string): Promise<void> {
  if (!url.startsWith("file:")) return;
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = NORMAL");
  await client.execute("PRAGMA foreign_keys = ON");
}
import * as tenantSchema from "./schema/tenant/index.ts";
import { envConfig } from "@config/env.ts";
import { useSymmetricDecrypt } from "@services/encryption/encryption.helper.ts";
import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";

const TENANT_MIGRATIONS_DIR = "./db/tenant-migrations";

/**
 * Regex that matches a valid `environmentId`.
 *
 * Environment IDs are NanoIDs (see `generateIdForEnvironment`), drawn from the
 * `LOWER_UPPER_NUMBERS` alphabet (`0-9`, `A-Z`, `a-z`) — NOT CUID2s. The bound
 * here is intentionally permissive on length to tolerate future ID-policy
 * changes while still rejecting empty/oversized values; the alphabet
 * restriction is what guarantees the value is filesystem-safe (no `/`, `.`, or
 * `..` segments can appear).
 */
const ENVIRONMENT_ID_RE = /^[0-9A-Za-z]{8,32}$/;

/**
 * Directory (relative to the process CWD) that holds all local `file:` SQLite
 * databases — both the global DB and every per-tenant DB.
 *
 * This MUST match the location the global DB uses (`getGlobalDB` →
 * `file:./.data/db/global.db`). Resolving against the CWD — not
 * `import.meta.url` — keeps tenant and global databases in the same directory.
 * Resolving against `import.meta.url` would place tenant DBs under `db/.data/`
 * (next to this source file) while the global DB lived under `.data/`,
 * splitting the data and causing `SQLITE_CANTOPEN` for tenants.
 */
const LOCAL_DB_DIR = "./.data/db/";

/** Cached absolute path of {@link LOCAL_DB_DIR}, resolved against the CWD. */
const localDbBaseAbs = new URL(LOCAL_DB_DIR, `file://${Deno.cwd()}/`).pathname;

/**
 * Returns the validated, resolved `file:` URL for a tenant SQLite database.
 *
 * Validates `environmentId` against the expected NanoID shape, then resolves
 * the final path against the local DB directory so that any relative `..`
 * segments are collapsed and cannot escape it.  Throws if the resolved path
 * would escape the expected directory (path-traversal guard).
 *
 * Use this function everywhere an `environmentId` is interpolated into a DB
 * file path.  Never build the path manually.
 */
export function tenantDbPath(environmentId: string): string {
  if (!ENVIRONMENT_ID_RE.test(environmentId)) {
    throw new Error(
      `tenantDbPath: invalid environmentId format — expected an alphanumeric NanoID, got: "${environmentId}"`,
    );
  }
  const base = localDbBaseAbs;
  const resolved = new URL(
    `${envConfig.database.dbShortCode}${environmentId}.db`,
    `file://${base}`,
  ).pathname;

  if (!resolved.startsWith(base)) {
    throw new Error(
      `tenantDbPath: path traversal detected — resolved path "${resolved}" escapes base directory "${base}"`,
    );
  }
  return `file:${resolved}`;
}

/**
 * Ensures the local DB directory exists. SQLite/libSQL will create the database
 * *file* on first open, but not its parent *directories* — a missing directory
 * surfaces as `ConnectionFailed(... SQLITE_CANTOPEN)`. Idempotent.
 */
async function ensureLocalDbDir(): Promise<void> {
  await Deno.mkdir(localDbBaseAbs, { recursive: true });
}

export type GlobalDB = LibSQLDatabase<typeof globalSchema>;
export type TenantDB = LibSQLDatabase<typeof tenantSchema>;

export const globalTables = globalSchema;
export const tenantTables = tenantSchema;

export const tables = {
  ...globalSchema,
  ...tenantSchema,
  global: globalSchema,
  tenant: tenantSchema,
};

// --- Global DB (singleton) ---
let globalClient: LibSQLClient | undefined;
let globalDrizzle: GlobalDB | undefined;

function isLocalDev(): boolean {
  return envConfig.isDevelopment || envConfig.env === "development";
}

/** One-time pragma initialization for the global DB (resolves immediately for non-file DBs). */
let globalPragmasReady: Promise<void> | undefined;

export function getGlobalDB(): GlobalDB {
  if (!globalClient) {
    if (isLocalDev()) {
      // SQLite creates the DB file but not its parent directory; ensure it
      // exists so the first open doesn't fail with SQLITE_CANTOPEN. Sync because
      // this accessor is synchronous. Idempotent.
      Deno.mkdirSync(localDbBaseAbs, { recursive: true });
    }
    const url = isLocalDev() ? `file:${LOCAL_DB_DIR}global.db` : envConfig.database.globalSqliteUrl!;
    globalClient = isLocalDev() ? createClient({ url }) : createClient({
      url,
      authToken: envConfig.database.globalSqliteToken!,
    });
    globalPragmasReady = ensureLocalPragmas(globalClient, url);
  }
  if (!globalDrizzle) {
    const retryClient = isLocalDev() ? wrapClientWithBusyRetry(globalClient) : globalClient;
    const tracedClient = wrapClientWithTracing(retryClient);
    globalDrizzle = drizzle(tracedClient, { schema: globalSchema });
  }
  return globalDrizzle;
}

/**
 * Ensures global DB pragmas have been applied. Call once at app startup
 * or before the first global DB write under contention.
 */
export async function ensureGlobalDBReady(): Promise<void> {
  getGlobalDB(); // ensure client is created
  await globalPragmasReady;
}

// --- Tenant DB (per-environment with inflight deduplication + LRU) ---
interface TenantConnection {
  client: LibSQLClient;
  db: TenantDB;
  lastUsed: number;
}

const MAX_TENANT_CONNECTIONS = envConfig.database.maxTenantConnections;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const tenantConnections = new Map<string, TenantConnection>();
const inflightConnections = new Map<string, Promise<TenantDB>>();

/** Tracks tenant IDs that have been migrated this process lifetime. */
const migratedTenants = new Set<string>();

import { requestContext } from "./context.ts";

export async function getTenantDB(environmentId?: string): Promise<TenantDB> {
  const envId = environmentId || requestContext.getStore()?.environmentId;

  if (!envId) {
    throw new Error("getTenantDB: environmentId is required when called outside of request context");
  }

  // 1. Cache hit
  const existing = tenantConnections.get(envId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.db;
  }

  // 2. Inflight deduplication — prevent thundering herd
  const inflight = inflightConnections.get(envId);
  if (inflight) return inflight;

  // 3. Create connection (only one concurrent creation per tenant)
  const connectionPromise = createTenantConnection(envId);
  inflightConnections.set(envId, connectionPromise);

  try {
    return await connectionPromise;
  } finally {
    inflightConnections.delete(envId);
  }
}

async function createTenantConnection(environmentId: string): Promise<TenantDB> {
  // Evict LRU if at capacity
  if (tenantConnections.size >= MAX_TENANT_CONNECTIONS) {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [id, conn] of tenantConnections) {
      if (conn.lastUsed < oldestTime) {
        oldestTime = conn.lastUsed;
        oldest = id;
      }
    }
    if (oldest) {
      const conn = tenantConnections.get(oldest);
      if (conn) {
        conn.client.close();
        tenantConnections.delete(oldest);
      }
    }
  }

  let client: LibSQLClient;
  let clientUrl: string;
  if (isLocalDev()) {
    // In local dev, we use file-based SQLite (path is validated by tenantDbPath).
    // Ensure the parent directory exists first — SQLite creates the file but not
    // the directory, so a missing dir surfaces as SQLITE_CANTOPEN.
    await ensureLocalDbDir();
    clientUrl = tenantDbPath(environmentId);
    client = createClient({ url: clientUrl });
  } else {
    // Fetch encrypted credentials from global DB, decrypt, connect
    const creds = await getDecryptedTenantCredentials(environmentId);
    clientUrl = creds.url;
    client = createClient({ url: creds.url, authToken: creds.token });
  }

  // Ensure WAL mode and busy_timeout are set before any queries/transactions
  await ensureLocalPragmas(client, clientUrl);

  const retryClient = isLocalDev() ? wrapClientWithBusyRetry(client) : client;
  const tracedClient = wrapClientWithTracing(retryClient);
  const db = drizzle(tracedClient, { schema: tenantSchema });

  // Run migrations on first connection per process lifetime.
  //
  // This is gated behind `runTenantMigrationsOnConnect` because `migrate()` is
  // expensive on the request hot path: on the first connection to a cold tenant
  // it reads/creates `__drizzle_migrations` and round-trips the libSQL client
  // even when no migrations are pending (observed ~1.4s on a cold tenant). In
  // production, migrations should be applied at deploy time via
  // `deno task db:migrate:tenant`, and this flag set to "false" so no request
  // ever pays that cost. In development it stays enabled so schema changes apply
  // automatically.
  if (envConfig.database.runTenantMigrationsOnConnect && !migratedTenants.has(environmentId)) {
    try {
      await runTenantMigrations(db);
      migratedTenants.add(environmentId);
    } catch (error) {
      // Close the client on migration failure — don't cache a broken connection
      client.close();
      throw error;
    }
  }

  tenantConnections.set(environmentId, { client, db, lastUsed: Date.now() });
  return db;
}

/**
 * Applies pending Drizzle tenant migrations against the given tenant DB.
 *
 * Extracted so it can be invoked explicitly (e.g. at startup or from a CLI
 * task) instead of lazily on the request hot path. Idempotent — Drizzle skips
 * migrations already recorded in `__drizzle_migrations`.
 */
export async function runTenantMigrations(db: TenantDB): Promise<void> {
  await migrate(db, { migrationsFolder: TENANT_MIGRATIONS_DIR });
}

export async function getDecryptedTenantCredentials(environmentId: string): Promise<{ url: string; token: string }> {
  const globalDb = getGlobalDB();
  const [registryEntry] = await globalDb
    .select()
    .from(globalSchema.environmentSqliteRegistry)
    .where(eq(globalSchema.environmentSqliteRegistry.id, environmentId))
    .limit(1);

  if (!registryEntry) {
    throw new Error(`Tenant DB registry entry not found for environment: ${environmentId}`);
  }

  const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
    envConfig.auth.generalEncryptionKey!,
    HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
  );

  const decryptedUrl = await useSymmetricDecrypt({
    key: encryptionKey,
    data: registryEntry.dbUrlEncrypted as Uint8Array,
  });

  const decryptedToken = await useSymmetricDecrypt({
    key: encryptionKey,
    data: registryEntry.dbTokenEncrypted as Uint8Array,
  });

  return {
    url: new TextDecoder().decode(decryptedUrl),
    token: new TextDecoder().decode(decryptedToken),
  };
}

// --- Idle eviction sweep ---
setInterval(() => {
  const now = Date.now();
  for (const [id, conn] of tenantConnections) {
    if (now - conn.lastUsed > IDLE_TIMEOUT_MS) {
      conn.client.close();
      tenantConnections.delete(id);
    }
  }
}, 60_000);

export function evictTenantDB(environmentId: string) {
  const cached = tenantConnections.get(environmentId);
  if (cached) {
    cached.client.close();
    tenantConnections.delete(environmentId);
  }
  inflightConnections.delete(environmentId);
}

/**
 * Checks whether an error is an SQLITE_BUSY / "database is locked" error.
 */
function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("SQLITE_BUSY") ||
    error.message.includes("database is locked")
  );
}

/**
 * Wraps a libsql client so that **every** query (insert, update, delete,
 * select, batch, transaction) is automatically retried on SQLITE_BUSY.
 *
 * This is more robust than wrapping individual drizzle methods because it
 * catches all operations at the driver level — including inserts, updates,
 * deletes, and transactions — regardless of how the query builder is chained.
 *
 * The `@libsql/client/node` driver does not reliably honour `PRAGMA busy_timeout`
 * for intra-process concurrency, so we retry at the application level with
 * exponential backoff + jitter.
 */
function wrapClientWithBusyRetry(client: LibSQLClient, maxRetries = 4): LibSQLClient {
  const origExecute = client.execute.bind(client);
  const origBatch = client.batch.bind(client);
  const origTransaction = client.transaction.bind(client);

  async function retry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0;; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        if (!isBusyError(error) || attempt >= maxRetries) throw error;
        // Exponential backoff: ~50ms, ~100ms, ~200ms, ~400ms + jitter
        const delay = (50 << attempt) + Math.random() * 30;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // deno-lint-ignore no-explicit-any
  (client as any).execute = (stmt: any) => retry(() => origExecute(stmt));
  // deno-lint-ignore no-explicit-any
  (client as any).batch = (stmts: any, mode?: any) => retry(() => origBatch(stmts, mode));
  // deno-lint-ignore no-explicit-any
  (client as any).transaction = (fn: any) => retry(() => origTransaction(fn));

  return client;
}

/**
 * Normalize and truncate a SQL statement for tracing previews.
 * - Collapses whitespace to single spaces
 * - Trims
 * - Truncates to 200 chars with "…" suffix
 * - Never logs param values, only the SQL template
 */
function truncateSqlPreview(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim();
  return normalized.length > 200 ? normalized.slice(0, 200) + "…" : normalized;
}

/**
 * Wraps a libSQL client so that every execute/batch call emits a tracing span
 * with duration and result metadata. The wrapper is a no-op (returns the raw
 * client) when tracing is disabled via envConfig.
 *
 * Wrap order is intentionally: drizzle(tracing(retry(rawClient))). Tracing is
 * outermost so spans reflect the caller's observed latency including any
 * busy-retry attempts nested inside.
 *
 * Individual retry attempts are invisible to the tracing layer by design.
 * transaction() is NOT wrapped — see Phase 1 non-goals in the design spec.
 */
export function wrapClientWithTracing(client: LibSQLClient): LibSQLClient {
  if (!envConfig.tracing.enabled) {
    return client;
  }

  const origExecute = client.execute.bind(client);
  const traceService = getTraceContext();

  // deno-lint-ignore no-explicit-any
  (client as any).execute = async (stmt: any) => {
    const sql: string = typeof stmt === "string" ? stmt : (stmt?.sql ?? "");
    const paramsValue = typeof stmt === "string" ? undefined : stmt?.args;
    const paramsCount = Array.isArray(paramsValue)
      ? paramsValue.length
      : paramsValue && typeof paramsValue === "object"
      ? Object.keys(paramsValue).length
      : 0;

    const span = traceService.startSpan("db.execute", "db.query", {
      "db.system": "sqlite",
      "db.statement_preview": truncateSqlPreview(sql),
      "db.params_count": paramsCount,
    });

    try {
      // deno-lint-ignore no-explicit-any
      const result: any = await origExecute(stmt);
      span.attributes["db.rows_returned"] = Array.isArray(result?.rows) ? result.rows.length : 0;
      span.attributes["db.rows_affected"] = typeof result?.rowsAffected === "number" ? result.rowsAffected : 0;
      span.status = "ok";
      return result;
    } catch (error) {
      span.status = "error";
      span.error = {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      };
      throw error;
    } finally {
      traceService.finishSpan(span);
    }
  };

  const origBatch = client.batch.bind(client);

  // deno-lint-ignore no-explicit-any
  (client as any).batch = async (stmts: any, mode?: any) => {
    const batchSize = Array.isArray(stmts) ? stmts.length : 0;

    const span = traceService.startSpan("db.batch", "db.query", {
      "db.system": "sqlite",
      "db.batch_size": batchSize,
    });

    try {
      // deno-lint-ignore no-explicit-any
      const results: any = await origBatch(stmts, mode);
      const totalRowsAffected = Array.isArray(results)
        ? results.reduce(
          (sum: number, r: { rowsAffected?: number }) => sum + (typeof r?.rowsAffected === "number" ? r.rowsAffected : 0),
          0,
        )
        : 0;
      const totalRowsReturned = Array.isArray(results)
        ? results.reduce(
          (sum: number, r: { rows?: unknown[] }) => sum + (Array.isArray(r?.rows) ? r.rows.length : 0),
          0,
        )
        : 0;
      span.attributes["db.rows_affected"] = totalRowsAffected;
      span.attributes["db.rows_returned"] = totalRowsReturned;
      span.status = "ok";
      return results;
    } catch (error) {
      span.status = "error";
      span.error = {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      };
      throw error;
    } finally {
      traceService.finishSpan(span);
    }
  };

  return client;
}

// For compatibility during migration
export const getDB = getGlobalDB;
export const getWorkerDB = getGlobalDB;
