/**
 * @file config/env.ts
 * @description Loads and validates environment variables from .env
 */
// Load environment variables from `.env` ONLY. We use an explicit `loadSync`
// (instead of the bare `import "@std/dotenv/load"` side-effect) so we can fully
// control which sources contribute to runtime config.
import { loadSync } from "@std/dotenv/mod";
loadSync({ allowEmptyValues: true, export: true, defaultsPath: null, examplePath: null });

/**
 * Convert MB value from environment variable to bytes
 */
function mbToBytes(envVar: string, defaultMB: number): number {
  const mb = parseInt(Deno.env.get(envVar) || defaultMB.toString());
  if (isNaN(mb) || mb < 0) {
    console.warn(
      `Invalid cache size for ${envVar}: ${Deno.env.get(envVar)}. Using default: ${defaultMB}MB`,
    );
    return defaultMB * 1024 * 1024;
  }
  return mb * 1024 * 1024;
}

export const envConfig = {
  baseDomain: Deno.env.get("BASE_DOMAIN") || "localhost",
  env: Deno.env.get("NODE_ENV") || "development",
  isDevelopment: Deno.env.get("NODE_ENV") === "development",
  isProduction: Deno.env.get("NODE_ENV") === "production",
  isTest: Deno.env.get("NODE_ENV") === "test",
  database: {
    url: Deno.env.get("DATABASE_URL"),
    dbShortCode: Deno.env.get("DATABASE_SHORT_CODE") || "MODZ",
    globalSqliteUrl: Deno.env.get("GLOBAL_SQLITE_URL"),
    globalSqliteToken: Deno.env.get("GLOBAL_SQLITE_TOKEN"),
    maxTenantConnections: parseInt(Deno.env.get("MAX_TENANT_CONNECTIONS") || "50"),
    // Whether to run Drizzle tenant migrations lazily on the first connection
    // to each tenant DB per process. This is convenient in development (schemas
    // change constantly) but in production it puts the full migrator round-trip
    // (~1s+, reads/creates `__drizzle_migrations`) on the FIRST request that
    // touches a cold tenant DB. In production, run `deno task db:migrate:tenant`
    // at deploy time and set this to "false" so requests never pay that cost.
    // Defaults to true unless explicitly disabled.
    runTenantMigrationsOnConnect: Deno.env.get("RUN_TENANT_MIGRATIONS_ON_CONNECT") !== "false",
  },
  cache: {
    isRedisEnabled: Deno.env.get("CACHE_REDIS_ENABLED") === "true",
    redisHost: Deno.env.get("CACHE_REDIS_HOST"),
    redisPort: Deno.env.get("CACHE_REDIS_PORT"),
    redisPassword: Deno.env.get("CACHE_REDIS_PASSWORD"),
    redisDb: Deno.env.get("CACHE_REDIS_DB"),
    enableMultiTier: Deno.env.get("CACHE_MULTI_TIER_ENABLED") === "true",
    enableCacheBus: Deno.env.get("CACHE_BUS_ENABLED") === "true", // Enable for multi-instance deployments
    // DB-backed durable cache (read-through/write-through) for allow-listed namespaces.
    // Default OFF: when false the facade is provider-only (no behavior change). Phase 1
    // opts in only AUTH.REFRESH_TOKENS. See plans/durable-cache-layer.md.
    durableEnabled: Deno.env.get("CACHE_DURABLE_ENABLED") === "true",
    // Max time (ms) to wait for the initial Redis connection before falling
    // back to Deno KV. Prevents a stalled/cold Redis handshake from blocking
    // the first cache operation (and the request that triggers it).
    redisConnectTimeoutMs: parseInt(Deno.env.get("CACHE_REDIS_CONNECT_TIMEOUT_MS") || "1500"),
    l1MaxSize: mbToBytes("CACHE_L1_MAX_SIZE_MB", 20), // Default: 20MB
    l1MaxEntries: parseInt(Deno.env.get("CACHE_L1_MAX_ENTRIES") || "10000"),
    bloomFilter: Deno.env.get("BLOOM_FILTER_ENABLED") !== "false",

    l1LargeValueThresholdKB: 10,
    ttlCleanupIntervalMinutes: 5,
    warmupDelaySeconds: 1,
    busRetryDelaySeconds: 5,

    // Redis-specific configuration
    redisBatchSize: 100,
    redisKeysScanLimit: 10000, // Default: 10K keys max
    redisMemoryScanLimit: 5000, // Default: 5K keys for memory calc
  },
  storage: {
    type: Deno.env.get("STORAGE_TYPE") || "bunny",
    region: Deno.env.get("STORAGE_REGION"),
    name: Deno.env.get("STORAGE_NAME"), // Bunny zone name OR S3 bucket name
    key: Deno.env.get("STORAGE_ACCESS_KEY"), // Bunny access key OR AWS access key ID
    secretKey: Deno.env.get("STORAGE_SECRET_KEY"), // AWS secret access key (not used by Bunny)
    endpoint: Deno.env.get("STORAGE_ENDPOINT"), // S3-compatible endpoint URL
    encryptionKey: Deno.env.get("STORAGE_FILE_ENCRYPTION"),
    cdnTokenKey: Deno.env.get("STORAGE_CDN_TOKEN_KEY"), // BunnyCDN Token Authentication key
  },
  backup: {
    enabled: Deno.env.get("BACKUP_ENABLED") === "true",
    dailyRetentionDays: parseInt(Deno.env.get("BACKUP_DAILY_RETENTION_DAYS") || "30"),
    weeklyRetentionWeeks: parseInt(Deno.env.get("BACKUP_WEEKLY_RETENTION_WEEKS") || "12"),
    monthlyRetentionMonths: parseInt(Deno.env.get("BACKUP_MONTHLY_RETENTION_MONTHS") || "12"),
    jobTimeoutMs: parseInt(Deno.env.get("BACKUP_JOB_TIMEOUT_MS") || String(2 * 60 * 60 * 1000)),
    lockRefreshIntervalMs: parseInt(
      Deno.env.get("BACKUP_LOCK_REFRESH_INTERVAL_MS") || String(10 * 60 * 1000),
    ),
  },
  backupStorage: {
    type: Deno.env.get("BACKUP_STORAGE_TYPE") || "", // "bunny" | "s3" | "local"
    region: Deno.env.get("BACKUP_STORAGE_REGION") || "",
    name: Deno.env.get("BACKUP_STORAGE_NAME") || "", // Bunny zone OR S3 bucket
    key: Deno.env.get("BACKUP_STORAGE_ACCESS_KEY") || "",
    secretKey: Deno.env.get("BACKUP_STORAGE_SECRET_KEY") || "", // S3 only
    endpoint: Deno.env.get("BACKUP_STORAGE_ENDPOINT") || "", // S3 only
    localDir: Deno.env.get("BACKUP_STORAGE_LOCAL_DIR") || "./.data-backup", // local only (dev/test)
  },
  objectBackup: {
    enabled: Deno.env.get("OBJECT_BACKUP_ENABLED") === "true",
    deleteGraceDays: parseInt(Deno.env.get("OBJECT_BACKUP_DELETE_GRACE_DAYS") || "30"),
    batchLimit: parseInt(Deno.env.get("OBJECT_BACKUP_BATCH_LIMIT") || "500"),
    jobTimeoutMs: parseInt(Deno.env.get("OBJECT_BACKUP_JOB_TIMEOUT_MS") || String(2 * 60 * 60 * 1000)),
    lockRefreshIntervalMs: parseInt(
      Deno.env.get("OBJECT_BACKUP_LOCK_REFRESH_INTERVAL_MS") || String(10 * 60 * 1000),
    ),
  },
  auth: {
    passwordPepper: Deno.env.get("AUTH_PASSWORD_PEPPER"),
    newPasswordPepper: Deno.env.get("AUTH_PASSWORD_PEPPER_NEW"),
    isPasswordRotationInProgress: Deno.env.get("AUTH_PEPPER_ROTATION") === "true",
    jwtPrivate: Deno.env.get("AUTH_JWT_PRIVATE_KEY"),
    jwtPublic: Deno.env.get("AUTH_JWT_PUBLIC_KEY"),
    jwtAlgo: Deno.env.get("AUTH_JWT_ALGO"),
    jwtCurve: Deno.env.get("AUTH_JWT_CURVE"),
    apiKeyPrefix: Deno.env.get("AUTH_API_KEY_PREFIX"),
    refreshKey: Deno.env.get("AUTH_REFRESH_SECRET_KEY"),
    generalEncryptionKey: Deno.env.get("AUTH_GENERAL_ENCRYPTION_KEY"),
  },
  logger: {
    key: Deno.env.get("LOGGER_KEY"),
    url: Deno.env.get("LOGGER_URL"),
  },
  mail: {
    fromEmail: Deno.env.get("MAIL_FROM_EMAIL"),
    devHost: "192.168.50.240",
    devPort: 1025,
    replyToEmail: Deno.env.get("MAIL_REPLY_TO"),
    key: Deno.env.get("MAIL_SECRET_KEY"),
    svixSecret: Deno.env.get("MAIL_SVIX_SECRET"),
    webhookToken: Deno.env.get("MAIL_WEBHOOK_URI"),
  },
  public: {
    // Canonical hostname of the user-facing frontend (SPA). Used as the prefix
    // for every link emitted in emails and public shares (register, password
    // reset, unsubscribe, public notes/documents links, email assets CDN).
    frontURL: Deno.env.get("PUBLIC_FRONTEND_URL") || "app.example.com",
    // Canonical hostname of the backend API. Used as the JWT `iss` and as the
    // base for every JWT `aud` (`<backURL>/api`, `<backURL>/api/auth/...`,
    // `<backURL>/api/email`, ...). MUST be the host that actually serves the
    // `/api/*` routes, otherwise every signed token fails audience checks.
    backURL: Deno.env.get("PUBLIC_BACKEND_URL") || "api.example.com",
    appName: Deno.env.get("PUBLIC_APP_NAME") || "Deno Advanced Boilerplate",
  },
  private: {
    isInternalToolsEnabled: Deno.env.get("INTERNAL_TOOL_ACTIVE") === "true",
    internalToolToken: Deno.env.get("INTERNAL_TOOL_KEY"),
    isInternalToolsIpRestricted: Deno.env.get("INTERNAL_TOOL_IP_RESTRICTION") === "true",
  },
  tracing: {
    enabled: Deno.env.get("TRACING_ENABLED") !== "false", // Default: enabled
  },
  threatIntelligence: {
    enabled: Deno.env.get("THREAT_INTELLIGENCE_ENABLED") !== "false",
  },
  jwt: {
    tokenTTL: {
      authExpiration: parseInt(Deno.env.get("JWT_TTL_AUTH_EXPIRATION") || "900"), // 15 mins (900 seconds)
      refreshExpiration: parseInt(Deno.env.get("JWT_TTL_REFRESH_EXPIRATION") || "604800"), // 7 days
      lifeSpan: parseInt(Deno.env.get("JWT_TTL_LIFESPAN") || "3888000"), // 45 days
      lifeSpanLongLived: parseInt(Deno.env.get("JWT_TTL_LIFESPAN_LONG_LIVED") || "7776000"), // 90 days
      email: parseInt(Deno.env.get("JWT_TTL_EMAIL") || "2592000"), // 30 days (long-lived for unsubscribe)
      magic: parseInt(Deno.env.get("JWT_TTL_MAGIC") || "600"), // 10 minutes (short for security)
      twoFactor: parseInt(Deno.env.get("JWT_TTL_TWO_FACTOR") || "60"), // 1 minute (very short for 2FA)
      verify: parseInt(Deno.env.get("JWT_TTL_VERIFY") || "60"), // 1 minute (very short for verification)
      reset: parseInt(Deno.env.get("JWT_TTL_RESET") || "900"), // 15 minutes (secure window for password reset)
      multiUser: parseInt(Deno.env.get("JWT_TTL_MULTI_USER") || "60"), // 1 minute (short window for user selection)
    },
  },
  // Most timing protection now uses dynamic calculation based on operation complexity
  // See utils/shared/timing.ts for the new centralized timing system
  // However, cryptographic operations remain configurable due to hardware dependencies
  timingProtection: {
    // Enable/disable timing protection globally (useful for tests)
    enabled: Deno.env.get("ENABLE_TIMING_PROTECTION") !== "false", // Default: enabled
    // Password operations (Scrypt) - hardware dependent, needs tuning
    passwordOperation: parseInt(
      Deno.env.get("TIMING_PASSWORD_OPERATIONS_VALUE") || "250",
    ),
  },
  highFrequencyEntitiesCaching: {
    documents: Deno.env.get("HIGH_FREQUENCY_USAGE_DOCUMENTS") === "true",
  },
  rateLimit: {
    enabled: Deno.env.get("RATE_LIMIT_ENABLED") !== "false", // Default: enabled
    failClosed: Deno.env.get("RATE_LIMIT_FAIL_CLOSED") === "true", // Default: fail-open
  },
  jobType: (Deno.env.get("JOB_MODE") as "worker" | "inline" | "none") || "none",
  // When false, the per-job `runners` allowlist is ignored and every job runs on
  // whatever runner is active. Handy for small/single-process deployments where
  // running the backups in the main app is fine. Default: enforced.
  enforceJobRunnerAllowlist: Deno.env.get("JOBS_ENFORCE_RUNNER_ALLOWLIST") !== "false",
  workers: {
    maxDecryptWorkers: parseInt(Deno.env.get("WORKERS_MAX_DECRYPT") || "1"),
    maxEncryptWorkers: parseInt(Deno.env.get("WORKERS_MAX_ENCRYPT") || "1"),
    maxJobConcurrent: parseInt(Deno.env.get("JOBS_MAX_CONCURRENT") || "2"),
  },
  notifications: {
    retentionDays: parseInt(Deno.env.get("NOTIFICATION_RETENTION_DAYS") || "30"),
  },
  bootstrap: {
    runBootstrap: Deno.env.get("RUN_BOOTSTRAP") === "true",
    envName: Deno.env.get("BOOTSTRAP_ENV_NAME") || "Default Environment",
    envDescription: Deno.env.get("BOOTSTRAP_ENV_DESCRIPTION") || null,
    tenantDbUrl: Deno.env.get("BOOTSTRAP_TENANT_DB_URL") || null,
    tenantDbToken: Deno.env.get("BOOTSTRAP_TENANT_DB_TOKEN") || "",
    adminEmail: Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") || null,
    adminPassword: Deno.env.get("BOOTSTRAP_ADMIN_PASSWORD") || null,
    adminFirstName: Deno.env.get("BOOTSTRAP_ADMIN_FIRST_NAME") || "System",
    adminLastName: Deno.env.get("BOOTSTRAP_ADMIN_LAST_NAME") || "Administrator",
  },
};

const REQUIRED_SECRETS: Array<{ name: string; value: string | undefined }> = [
  { name: "AUTH_PASSWORD_PEPPER", value: envConfig.auth.passwordPepper },
  { name: "AUTH_JWT_PRIVATE_KEY", value: envConfig.auth.jwtPrivate },
  { name: "AUTH_JWT_PUBLIC_KEY", value: envConfig.auth.jwtPublic },
  { name: "AUTH_REFRESH_SECRET_KEY", value: envConfig.auth.refreshKey },
  { name: "AUTH_GENERAL_ENCRYPTION_KEY", value: envConfig.auth.generalEncryptionKey },
  { name: "STORAGE_FILE_ENCRYPTION", value: envConfig.storage.encryptionKey },
];

/** Crypto secrets must be non-trivial; anything shorter is rejected. */
const MIN_SECRET_LENGTH = 16;

function stripSchemeAndPath(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

function assertHostMatchesBaseDomain(label: string, raw: string): void {
  const host = stripSchemeAndPath(raw);
  if (!host) {
    throw new Error(`${label} is required (set the corresponding env var, bare hostname, no scheme).`);
  }
  const base = envConfig.baseDomain.toLowerCase();
  if (host !== base && !host.endsWith("." + base)) {
    throw new Error(
      `${label} ("${host}") must equal BASE_DOMAIN ("${base}") or be a subdomain of it. ` +
        `A wrong value silently breaks JWT verification, cookies, WebAuthn RP ID, or CORS.`,
    );
  }
}

if (!envConfig.isTest) {
  // Frontend and backend hostnames must live under BASE_DOMAIN so cookies,
  // WebAuthn RP ID, CORS, and JWT iss/aud all agree on the registrable parent.
  // Skipped when BASE_DOMAIN is "localhost" (dev: same-origin on different ports).
  if (envConfig.baseDomain !== "localhost") {
    assertHostMatchesBaseDomain("PUBLIC_FRONTEND_URL", envConfig.public.frontURL);
    assertHostMatchesBaseDomain("PUBLIC_BACKEND_URL", envConfig.public.backURL);
  }

  const invalid = REQUIRED_SECRETS
    .map((secret) => {
      const value = secret.value?.trim();
      if (!value) return `${secret.name} (missing)`;
      if (value.length < MIN_SECRET_LENGTH) {
        return `${secret.name} (too short: ${value.length} chars, need ${MIN_SECRET_LENGTH})`;
      }
      return null;
    })
    .filter((reason): reason is string => reason !== null);

  if (invalid.length > 0) {
    throw new Error(
      `Invalid required secrets — set real values in .env / the runtime environment: ${invalid.join(", ")}`,
    );
  }
}
