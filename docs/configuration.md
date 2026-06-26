# Configuration Reference

This document is the complete environment-variable reference for the Deno Advanced Boilerplate. For a project overview and quickstart, see
the [README](../README.md).

All runtime configuration is loaded by `config/env.ts` from a `.env` file in the project root. The file is read with an explicit
`loadSync(...)` call (instead of the bare `import "@std/dotenv/load"` side-effect) so the source of every value is auditable.

### Required secrets (boot-time gate)

The following six secrets are validated at startup. When `NODE_ENV !== "test"`, the app **throws on launch** if any of them is missing or
shorter than 16 trimmed characters. Generate each with the command shown.

| Variable                      | Purpose                                                                                    | Generate with                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `AUTH_PASSWORD_PEPPER`        | Combined with every user password before Argon2id hashing.                                 | `openssl rand -base64 32`                                |
| `AUTH_JWT_PRIVATE_KEY`        | Ed25519 private key (seed) used to sign access / 2FA / magic-link JWTs.                    | `openssl rand -base64 32`                                |
| `AUTH_JWT_PUBLIC_KEY`         | Matching Ed25519 public key.                                                               | `openssl rand -base64 32`                                |
| `AUTH_REFRESH_SECRET_KEY`     | HMAC secret for the signed refresh-token cookie pair.                                      | `openssl rand 48 \| base64 \| tr '+/' '-_' \| tr -d '='` |
| `AUTH_GENERAL_ENCRYPTION_KEY` | Master symmetric key for tenant-DB credential encryption, TOTP secrets, backup codes, etc. | `openssl rand -base64 32`                                |
| `STORAGE_FILE_ENCRYPTION`     | Per-file symmetric key for user-uploaded content (profile pictures, attachments).          | `openssl rand -base64 32`                                |

You can verify your boot-time gate by running `deno check main.ts` — it will fail fast on missing/short secrets before any code path is
exercised.

### Generating random values

The two random generators that appear throughout the project:

```sh
# 32 random bytes, base64-encoded (use for most 32-byte keys)
openssl rand -base64 32

# URL-safe variant, no padding (use for the refresh-token HMAC secret and the admin token)
openssl rand -base64 48 | tr '+/' '-_' | tr -d '='
openssl rand -base64 256 | tr '+/' '-_' | tr -d '='
```

### Variable reference (deep-dive)

Variables are grouped by the section they live in inside `config/env.ts`. Every entry lists the default, the dev/prod guidance, and the most
common gotcha. The `.env` file shipped in this repo uses `moedzee.dev` / `moedzee` as placeholder values — replace them with your own.

#### 1. Application

| Var                   | Default           | Notes                                                                                                                                                                                                                                                                                                         |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_DOMAIN`         | `localhost`       | Parent domain for the WebAuthn/Passkey RP ID and the production cookie `Domain=` scope. **Must be the registrable parent** (e.g. `example.com`, not `app.example.com`) so passkeys work across `api.example.com`, `app.example.com`, etc. A wrong value silently breaks legitimate passkey logins.            |
| `NODE_ENV`            | `development`     | Master environment switch. In development the app uses local `file:` SQLite, MailHog SMTP, and skips the super-admin token check; in production it switches to libSQL/Turso, Resend, and requires HTTPS cookies. Setting the wrong value is the most common cause of "everything broke after deploy" reports. |
| `PUBLIC_FRONTEND_URL` | `app.example.com` | Bare hostname (no scheme, no trailing slash) of the user-facing frontend SPA. Used as the prefix for every link emitted in emails and public shares (register, password reset, unsubscribe, public notes/documents, email assets). Must equal `BASE_DOMAIN` or be a subdomain of it.                          |
| `PUBLIC_BACKEND_URL`  | `api.example.com` | Bare hostname (no scheme, no trailing slash) of the backend API. Used as the JWT `iss` and as the base for every JWT `aud` (`<backURL>/api`, `<backURL>/api/auth/...`, `<backURL>/api/email`, ...). MUST be the host that actually serves `/api/*`. Must equal `BASE_DOMAIN` or be a subdomain of it.         |

#### 2. Database (multi-tenant SQLite / libSQL)

| Var                      | Default | Notes                                                                                                                                                                                                                                                   |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | _unset_ | Only consumed by `scripts/benchmark-pool.ts`. The live runtime DB connection comes from `GLOBAL_SQLITE_URL` / `tenantDBUrl` instead.                                                                                                                    |
| `DATABASE_SHORT_CODE`    | `MODZ`  | Filename prefix for tenant SQLite files in local dev (`MODZ<environmentId>.db`). Ignored in production.                                                                                                                                                 |
| `GLOBAL_SQLITE_URL`      | _unset_ | libSQL/Turso HTTPS URL for the **global** database (the tenant registry, user records, encrypted tenant-DB credentials). Required in production; the app falls back to `file:./.data/db/global.db` in dev. Treat the URL as a secret if it embeds auth. |
| `GLOBAL_SQLITE_TOKEN`    | _unset_ | Bearer token paired with `GLOBAL_SQLITE_URL`. **Critical** — grants full read/write to the global DB; compromise is database root.                                                                                                                      |
| `MAX_TENANT_CONNECTIONS` | `50`    | LRU cap on in-process open tenant Drizzle clients. Tune to roughly `expected_concurrent_tenants × 1.2`; a very high value can allow file-handle-per-tenant DoS, a very low one causes connection thrash.                                                |

#### 3. Cache (3-tier L1 → L2)

The cache is a 3-tier singleton (see `services/cache/cache.service.ts:initializeCache`): an in-process **L1** memory cache, an **L2**
backend (Redis when enabled, otherwise Deno KV), and a **cache bus** over Redis Pub/Sub that keeps L1 in sync across instances. All cache
envs are read on first cache use, not at boot. None are required.

| Var                              | Default     | Notes                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CACHE_REDIS_ENABLED`            | `false`     | Master switch for using Redis as L2. With `false` the L2 is Deno KV regardless of the other Redis vars. Dev: `false` is enough on a single host. Prod: `true` for any multi-instance deploy.                                                                                                                                                 |
| `CACHE_REDIS_HOST`               | `localhost` | Redis hostname.                                                                                                                                                                                                                                                                                                                              |
| `CACHE_REDIS_PORT`               | `6379`      | Redis port.                                                                                                                                                                                                                                                                                                                                  |
| `CACHE_REDIS_PASSWORD`           | _unset_     | **High-value credential.** Grants read/write to every cache entry (JWT sessions, permission groups, rate-limit counters). Use `requirepass` and a private-network address in production; enable TLS (`rediss://`) when crossing trust boundaries.                                                                                            |
| `CACHE_REDIS_DB`                 | `0`         | Logical Redis DB index.                                                                                                                                                                                                                                                                                                                      |
| `CACHE_MULTI_TIER_ENABLED`       | `false`     | Enables the L1 + L2 code path. **When to enable / disable:** see the dedicated note below.                                                                                                                                                                                                                                                   |
| `CACHE_BUS_ENABLED`              | `false`     | Enables the Redis-Pub/Sub cache-bus that keeps L1 in sync across instances. **Effective only when both `CACHE_REDIS_ENABLED=true` AND `CACHE_MULTI_TIER_ENABLED=true`** (gated in `services/cache/redis-cache.provider.ts:68`). With the bus off, multi-tier still works on a single instance; you only lose cross-instance L1 invalidation. |
| `CACHE_REDIS_CONNECT_TIMEOUT_MS` | `1500`      | Race window for the initial Redis handshake before falling back to Deno KV. Keep ≤ 2 000 ms in production so a stalled Redis never blocks the first request of a cold instance.                                                                                                                                                              |
| `CACHE_L1_MAX_SIZE_MB`           | `20`        | L1 memory cap (in MB).                                                                                                                                                                                                                                                                                                                       |
| `CACHE_L1_MAX_ENTRIES`           | `10000`     | L1 entry cap.                                                                                                                                                                                                                                                                                                                                |
| `BLOOM_FILTER_ENABLED`           | `true`      | Toggles the ~240 KB Bloom filter used by the common-password check and threat-intel prefilter. Only the literal `"false"` disables it. Leave enabled.                                                                                                                                                                                        |

The following cache knobs are hard-coded in `config/env.ts` and **not** environment-overridable in the current build:
`l1LargeValueThresholdKB` (10 KB), `ttlCleanupIntervalMinutes` (5), `warmupDelaySeconds` (1), `busRetryDelaySeconds` (5), `redisBatchSize`
(100), `redisKeysScanLimit` (10 000), `redisMemoryScanLimit` (5 000).

##### `CACHE_MULTI_TIER_ENABLED` — when to enable

The L1 tier is a process-local memory cache (LRU, FIFO TTL sweep, Bloom prefilter) wrapped around the L2 backend. It is built and torn down
in `services/cache/multi-tier-cache.provider.ts`. L1 only shortens the round-trip for entries that are **hot in the current process** — the
L2 still owns durability. Decision matrix:

| Scenario                                              | Recommended             | Why                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single instance, low traffic                          | `false`                 | Deno KV alone has comparable latency for low QPS; the L1 machinery is pure overhead.                                                                                                                                                                                                                      |
| Single instance, high read QPS on a small set of keys | `true`                  | L1 turns the L2 round-trip into a memory read. Hot namespaces (JWT session, permission groups, rate-limit counters) get a 100×-plus speedup.                                                                                                                                                              |
| Multi-instance, **bus disabled**                      | `true` is **harmful**   | Each instance will have its own stale L1 copy until its own TTL fires. This is the classic "invalidation by TTL" anti-pattern — risk of serving stale data until expiry.                                                                                                                                  |
| Multi-instance, **bus enabled**                       | `true`                  | This is the intended production shape. Writes broadcast `invalidate_key` / `invalidate_pattern` / `clear_namespace` messages on the `cache_invalidation` channel, and every other instance drops its L1 entry. The own-instance message is filtered out by `instanceId` at `redis-cache.provider.ts:139`. |
| Redis-down fallback path                              | `true` (L1 still built) | Even if the L2 falls back to Deno KV, multi-tier still wires a smaller L1 (1/3 the size, 1/2 the entry cap — see `cache.service.ts:575-579`) and the warmup-on-boot path still runs.                                                                                                                      |

Three more code-level facts that drive the decision:

- **Namespaces are not created equal.** `multi-tier-cache.provider.ts:43-57` hard-codes `l1HotNamespaces` (always L1: JWT session,
  permission groups/user/api-key/admin, rate-limit, passkey challenge) and `l1SkipNamespaces` (always L2: permissions all, user sessions,
  threat-intel lookup cache). So enabling multi-tier only changes behavior for entries that are not already pinned to a tier.
- **Large values are skipped from L1.** `l1LargeValueThreshold` (10 KB) is checked in `shouldUseL1()` — a value over the threshold is
  L2-only, regardless of the multi-tier setting. This is the right behavior for media-metadata and document-cache entries.
- **Queues bypass L1.** `enqueue` / `dequeue` / `queueLength` / `acquireLock` / `releaseLock` always go to L2 — splitting queue state across
  tiers would break cross-instance ordering (`multi-tier-cache.provider.ts:323-354`).

##### Cache bus — additional notes

- The bus is a **second Redis connection** (a subscriber), separate from the main publisher connection used for read/write. It is spun up in
  `RedisCacheProvider.initializeCacheBus()` (`redis-cache.provider.ts:80-99`) and reconnects on failure with `busRetryDelaySeconds` backoff.
- Every L1-eligible write (`set` / `getAndDelete` / `delete` / `deletePattern` / `clearNamespace`) broadcasts to the bus. Reads never
  broadcast.
- Messages include `instanceId` and self-messages are skipped, so a write does **not** invalidate your own L1 — your L1 is updated
  synchronously in the same call.
- The bus is a private channel; in a managed Redis with ACLs, the application user needs `publish` and `subscribe` on `cache_invalidation`
  (or a key-pattern equivalent).

#### 4. Storage

`STORAGE_TYPE` selects the provider at `services/storage/singletons.ts`. The three supported providers are `bunny` (Bunny Storage), `s3`
(AWS or any S3-compatible endpoint), and `local` (filesystem under `.data/storage/`, dev only).

A boot-time **pre-flight** in `services/db-backup/preflight.ts` refuses to start the backup job with `STORAGE_TYPE=local` outside dev/test —
local backups on the same host are "DR theater".

| Var                       | Default | Notes                                                                                                                                                                                         |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_TYPE`            | `bunny` | `local` for dev, `bunny` or `s3` for production.                                                                                                                                              |
| `STORAGE_REGION`          | _unset_ | Bunny region (`NewYork`, `Frankfurt`, …) or AWS region (`us-east-1`).                                                                                                                         |
| `STORAGE_NAME`            | _unset_ | Bunny storage-zone name or S3 bucket name.                                                                                                                                                    |
| `STORAGE_ACCESS_KEY`      | _unset_ | Bunny access key (sent as the `AccessKey` HTTP header on every read/write) or AWS access-key ID. **High-value credential.**                                                                   |
| `STORAGE_SECRET_KEY`      | _unset_ | S3 only. Bunny does not use a secret key.                                                                                                                                                     |
| `STORAGE_ENDPOINT`        | _unset_ | S3 only. Required even for AWS to enable path-style addressing. For MinIO, set to `http://localhost:9000`.                                                                                    |
| `STORAGE_FILE_ENCRYPTION` | _unset_ | Per-file symmetric key. Boot-time validated (≥ 16 chars). **Master credential** — whoever holds it can decrypt every encrypted user file. See the "Required secrets" table for the generator. |
| `STORAGE_CDN_TOKEN_KEY`   | _unset_ | Reserved for BunnyCDN Token Authentication (signed-URL generation). No code reference yet; safe to leave blank until you wire up a signed-URL helper.                                         |

##### Provider-specific code notes

- **Bunny** (`services/storage/bunny.ts`): The constructor **throws at first storage use** if any of `STORAGE_REGION`, `STORAGE_NAME`, or
  `STORAGE_ACCESS_KEY` is missing. The access key is sent as the `AccessKey` HTTP header on **every** read and write (`bunny.ts:147`) — not
  just on uploads. This means a leaked access key gives full read/write/delete of every object in the zone; it is the **only** credential
  Bunny uses (no secret key, no scoped tokens). Rotate by issuing a new access key in the Bunny dashboard, then redeploy.
- **S3** (`services/storage/s3.ts`): The constructor throws if any of `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_REGION`,
  `STORAGE_NAME`, or `STORAGE_ENDPOINT` is missing. `forcePathStyle: true` is hard-coded so the same client works against AWS, MinIO, R2,
  Backblaze B2, etc. — set `STORAGE_ENDPOINT=https://s3.<region>.amazonaws.com` for AWS.
- **Local** (`services/storage/local.ts`): Writes go under `.data/storage/`. Only suitable for development. Any backup job in this
  configuration will be **refused at boot** by the pre-flight.
- **Switching providers** in production requires a **data migration**, not just an env change. The bucket/zone layout is the same
  (`backups/…`, `<environmentId>/…`), so a one-time `rclone copy` works. Set `BACKUP_ENABLED=false` during the cutover.

##### Encryption model

- `STORAGE_FILE_ENCRYPTION` is the symmetric key used by `services/user/enhanced-encryption.service.ts:326` to encrypt every user-uploaded
  file before it goes to storage. Files are encrypted in the application, then uploaded as opaque blobs.
- Decryption requires the same key; a rotation therefore requires a **re-encrypt pass** over every existing file, or a key-versioning scheme
  (not currently in place). Plan rotations as a scheduled maintenance window, not a hot swap.
- Backups are **not** encrypted by `STORAGE_FILE_ENCRYPTION` — they are gzipped SQL dumps uploaded as-is. Encrypt the bucket itself (S3 SSE,
  Bunny zone-side encryption) for at-rest protection.

#### 5. Backup (GFS retention)

When `BACKUP_ENABLED=true` and `STORAGE_TYPE` is `bunny`/`s3`, the `db-backup` job runs on the cron schedule and applies a
Grandfather-Father-Son retention policy to backup objects in the storage bucket.

| Var                               | Default           | Notes                                                                                         |
| --------------------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `BACKUP_ENABLED`                  | `false`           | Master switch. Prod: `true`. The pre-flight refuses `true` + `STORAGE_TYPE=local` in non-dev. |
| `BACKUP_DAILY_RETENTION_DAYS`     | `30`              |                                                                                               |
| `BACKUP_WEEKLY_RETENTION_WEEKS`   | `12`              |                                                                                               |
| `BACKUP_MONTHLY_RETENTION_MONTHS` | `12`              |                                                                                               |
| `BACKUP_JOB_TIMEOUT_MS`           | `7200000` (2 h)   | Per-run timeout. Raise if you have many tenants.                                              |
| `BACKUP_LOCK_REFRESH_INTERVAL_MS` | `600000` (10 min) | Must stay below the 30-minute job-lock TTL.                                                   |

#### 5b. Object-storage backup (off-site file copy — 3-2-1)

`OBJECT_BACKUP_ENABLED=true` turns on an **independent, incremental off-site copy of user file bytes** (documents, thumbnails, note
attachments) to a _different_ provider/account than `STORAGE_*` — the "1 off-site / independent" leg of 3-2-1. It is **complementary to**
the GFS DB backup (§5): a full restore needs **both**, plus the file-wrapping keys. The boot guard `services/object-backup/preflight.ts` is
**fail-closed** — it refuses to start if the destination is missing, shares credentials with the source (same access key = same account =
not off-site), or is `local` outside dev/test, and it requires `NODE_ENV` to be set explicitly (so its `"development"` default can't bypass
the check).

New objects are pushed incrementally off a per-row `backedUpAt` flag; deletions are deferred through a tombstone queue with a grace window
(so an accidental/malicious live delete does not immediately destroy the backup copy). Whole-environment teardown is purged from the backup
by explicit per-key delete (never `deleteDirectory`, which silently truncates). The job is registered **standalone-only** — run it via
`deno task jobs:standalone` so the 2-hour `timeoutMs` applies. Restore procedure and DR completeness: see
[`docs/object-storage-backup.md`](docs/object-storage-backup.md).

| Var                                      | Default           | Notes                                                                                                          |
| ---------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `OBJECT_BACKUP_ENABLED`                  | `false`           | Master switch. Enable only after `BACKUP_STORAGE_*` points at an independent account.                          |
| `BACKUP_STORAGE_TYPE`                    | _unset_           | `bunny` / `s3` / `local` (local dev/test only). Must be a DIFFERENT account than `STORAGE_*`.                  |
| `BACKUP_STORAGE_*`                       | _unset_           | Same shape as `STORAGE_*` (`…_REGION`, `…_NAME`, `…_ACCESS_KEY`, `…_SECRET_KEY`, `…_ENDPOINT`, `…_LOCAL_DIR`). |
| `OBJECT_BACKUP_DELETE_GRACE_DAYS`        | `30`              | Tombstone grace window before a deleted object's backup copy is purged.                                        |
| `OBJECT_BACKUP_BATCH_LIMIT`              | `500`             | Catalog rows processed per tenant per run.                                                                     |
| `OBJECT_BACKUP_JOB_TIMEOUT_MS`           | `7200000` (2 h)   | Standalone-runner per-run timeout.                                                                             |
| `OBJECT_BACKUP_LOCK_REFRESH_INTERVAL_MS` | `600000` (10 min) | Must stay below the 30-minute job-lock TTL.                                                                    |

#### 6. Authentication

| Var                           | Default | Notes                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_PASSWORD_PEPPER`        | _unset_ | **Master credential.** Combined with every password before Argon2id. Required (see Required secrets).                                                                                                                                                                                                                   |
| `AUTH_PASSWORD_PEPPER_NEW`    | _unset_ | Set this together with `AUTH_PEPPER_ROTATION=true` during a rotation. The system verifies against both peppers and re-hashes on the next successful login.                                                                                                                                                              |
| `AUTH_PEPPER_ROTATION`        | `false` | Set to `true` only while a pepper rotation is in progress. The canonical rotation flow is: deploy with `AUTH_PASSWORD_PEPPER_NEW=<new>` and `AUTH_PEPPER_ROTATION=true` → wait for all users to re-log-in → swap `AUTH_PASSWORD_PEPPER` to the new value → unset `AUTH_PASSWORD_PEPPER_NEW` and `AUTH_PEPPER_ROTATION`. |
| `AUTH_JWT_PRIVATE_KEY`        | _unset_ | **Master credential.** Ed25519 private key seed. Required.                                                                                                                                                                                                                                                              |
| `AUTH_JWT_PUBLIC_KEY`         | _unset_ | Matching Ed25519 public key. Required.                                                                                                                                                                                                                                                                                  |
| `AUTH_JWT_ALGO`               | _unset_ | Default is `EdDSA`. Throws at startup if blank.                                                                                                                                                                                                                                                                         |
| `AUTH_JWT_CURVE`              | _unset_ | Default is `Ed25519`. Throws at startup if blank.                                                                                                                                                                                                                                                                       |
| `AUTH_API_KEY_PREFIX`         | _unset_ | String prepended to issued API keys (e.g. `sk-mo-dz-e-…`). Pick a unique, branded prefix per environment so you can grep + revoke by prefix.                                                                                                                                                                            |
| `AUTH_REFRESH_SECRET_KEY`     | _unset_ | HMAC secret for the signed refresh-token cookie pair. Required.                                                                                                                                                                                                                                                         |
| `AUTH_GENERAL_ENCRYPTION_KEY` | _unset_ | **Master credential.** Root of the `HASHING_CONTEXTS.TENANT_DB_CREDENTIALS` key derivation. Compromise = database admin to every tenant. Rotation requires the escrow-key ceremony. Required.                                                                                                                           |

##### Pepper rotation procedure (in detail)

Pepper rotation is the only credential rotation that is **safe to do online** (no user-visible outage). The dual-pepper path in
`services/auth/password-auth.service.ts:141-162` works like this:

1. Generate a new pepper: `openssl rand -base64 32`.
2. Deploy with `AUTH_PASSWORD_PEPPER_NEW=<new>` and `AUTH_PEPPER_ROTATION=true`. The old pepper is still `AUTH_PASSWORD_PEPPER` and is used
   to verify existing hashes; the new pepper is used to verify any password that arrives in the dual-pepper window. On the **first
   successful login** the hash is silently re-derived under the new pepper.
3. Wait. Monitor the percentage of users who have re-logged-in. Common accelerators: force a session-expired event for a tenant, or send an
   "action required" email.
4. Once ≥ ~99% of users have re-logged-in (or you've decided to cut the cord), promote the new pepper: move `AUTH_PASSWORD_PEPPER_NEW` →
   `AUTH_PASSWORD_PEPPER`, and set `AUTH_PASSWORD_PEPPER_NEW=` and `AUTH_PEPPER_ROTATION=false`.
5. Users who never re-logged-in can no longer authenticate — they must use the password-reset flow, which itself is independent of pepper
   state.

#### 7. Logger (BetterStack)

| Var          | Default | Notes                                                                           |
| ------------ | ------- | ------------------------------------------------------------------------------- |
| `LOGGER_KEY` | _unset_ | BetterStack ingest token. Sent only in production. Treat as a write credential. |
| `LOGGER_URL` | _unset_ | BetterStack ingest URL.                                                         |

In dev, the structured logger writes to stdout only.

#### 8. Mail

The mail service picks the backend from `NODE_ENV`: in development it talks to a MailHog SMTP server at the hard-coded LAN address
`192.168.50.240:1025` (edit those constants in `config/env.ts:103-104` if your dev MailHog is elsewhere); in production it uses the Resend
HTTP API.

| Var                | Default | Notes                                                                                                                                                    |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAIL_FROM_EMAIL`  | _unset_ | `From:` address on outbound mail. Must be on a domain you control SPF/DKIM/DMARC for (Resend requirement).                                               |
| `MAIL_REPLY_TO`    | _unset_ | Optional `Reply-To:` address.                                                                                                                            |
| `MAIL_SECRET_KEY`  | _unset_ | Resend API key. Dev: leave unset. **High-value credential** in production — can be abused for phishing as your verified domain.                          |
| `MAIL_SVIX_SECRET` | _unset_ | Svix webhook signing secret for Resend → your app delivery webhooks. The first line of defense; verify in `handlers/webhooks/webhooks.handler.ts:209`.   |
| `MAIL_WEBHOOK_URI` | _unset_ | URL-secret path segment on the inbound webhook route. A second line of defense before Svix signature verification. Generate with `openssl rand -hex 32`. |

#### 9. Public app config

| Var               | Default                     | Notes                                                                         |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `PUBLIC_APP_NAME` | `Deno Advanced Boilerplate` | Display name. Used as the Passkey relying-party name and in 2FA email bodies. |

#### 10. Internal tools (admin UI)

| Var                            | Default | Notes                                                                                                                                                                                                                                          |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTERNAL_TOOL_ACTIVE`         | `false` | Master switch for the `/internal/__admin` admin UI. Deny by default in production.                                                                                                                                                             |
| `INTERNAL_TOOL_KEY`            | _unset_ | Long-lived bearer token presented via `Authorization`, `?token=…`, or a cookie. **High-value credential** — anyone with it can browse tenants and run admin operations. Generate with `openssl rand -base64 256 \| tr '+/' '-_' \| tr -d '='`. |
| `INTERNAL_TOOL_IP_RESTRICTION` | `false` | When `true`, additionally requires the client IP to be in the `INTERNAL_TOOLING_IP_WHITELIST_TAG` row of the `whitelistedIPs` table. Strongly recommended `true` in production as defense-in-depth.                                            |

##### Internal-tools flow (in detail)

The middleware at `middleware/super-admin.middleware.ts:22-199` runs in this order:

1. **Master switch** — if `INTERNAL_TOOL_ACTIVE=false`, the entire `/internal/__admin` subtree returns **404** (not 403 — a 403 would
   disclose the existence of the endpoint). Static assets under `/internal/__admin/assets/` are whitelisted so the SPA can boot.
2. **Dev escape hatch** — if `envConfig.isDevelopment`, the middleware `return await next()` with no token check. **Never** rely on this in
   production: a stray `NODE_ENV=development` in the prod environment is a total admin-UI compromise.
3. **`INTERNAL_TOOL_KEY` fast-path** — if a valid `Admin-Token` header / `admin_token` query / `Admin-Token` cookie is presented, the
   request is admitted and a short-lived (15 min) `Admin-Token` cookie is set on the parent domain. The token is compared with `safeEqual`
   (constant-time) and the request goes through `ensureMinimumProcessingTime` so a token-mismatch takes the same wall time as a token-match.
4. **Bearer JWT** — if no admin token, the middleware tries the standard `Authorization: Bearer <jwt>` path and verifies against the `auth`
   audience.
5. **IP restriction (optional)** — if `INTERNAL_TOOL_IP_RESTRICTION=true`, the verified user is additionally required to come from an IP
   whitelisted in the `whitelistedIPs` table with reason `INTERNAL_TOOLING_IP_WHITELIST_TAG`. Every denial is logged via
   `useLogSecurityEvent` as a `medium` event.

Operational guidance: do not put the admin token in your long-term `.env` file in source control. Issue a short-lived value to operators via
your secrets manager and rotate. Use the JWT path for long-running browser sessions so the long-lived token does not have to be persisted.

#### 11. Tracing

| Var               | Default | Notes                                                                                                                   |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `TRACING_ENABLED` | `true`  | Only the literal `"false"` disables it. Disabling removes every span (no perf overhead) but you lose error breadcrumbs. |

#### 12. Threat intelligence

| Var                           | Default | Notes                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `THREAT_INTELLIGENCE_ENABLED` | `true`  | Toggles the IP-based blocking in `requestContextMiddleware` and the per-request `checkIP()` call. Dev: leave enabled (it short-circuits in `isDevelopment` anyway). Prod: `true`. The service depends on the `threatSources` / `threatIPs` / `threatCIDRs` tables being populated — see `bulkImportThreatData` in `services/threat-intelligence/threat-intelligence.service.ts`. |

##### Threat-intel short-circuits (in code order)

`THREAT_INTELLIGENCE_ENABLED` and the environment interact in three places; turning it off is **not** a no-op:

1. `requestContextMiddleware` (`middleware/request-context.middleware.ts:55-60`) skips the `checkIP` call when
   `envConfig.isDevelopment || !envConfig.threatIntelligence.enabled`. The middleware still extracts the client IP and user agent, but
   `c.set("ipSecurityCheck", null)`. Downstream consumers must tolerate a `null` result.
2. `ThreatIntelligenceService.isReady()` returns `true` early in dev or when disabled — so a request that arrives **before** initialization
   is allowed (no `warming_up` 403).
3. `ThreatIntelligenceService.checkIP()` returns `{ action: "allow", reason: "Development mode - threat intelligence bypassed" }` without
   consulting any data when dev or disabled (`threat-intelligence.service.ts:157-160`).

The implication: **`THREAT_INTELLIGENCE_ENABLED=false` in production silently disables every IP-based blocklist** (TOR exit nodes, known
scanners, datacenter ranges, etc.). The middleware does not log a warning when this happens. If you want defense-in-depth during
threat-intel outages, set `RATE_LIMIT_FAIL_CLOSED=true` and `RATE_LIMIT_ENABLED=true` instead of disabling threat-intel.

#### 13. JWT TTLs (all in seconds)

| Var                           | Default             | Window                                                                   |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `JWT_TTL_AUTH_EXPIRATION`     | `900` (15 min)      | Access-token lifespan. Short by design.                                  |
| `JWT_TTL_REFRESH_EXPIRATION`  | `604800` (7 days)   | Refresh-token lifespan.                                                  |
| `JWT_TTL_LIFESPAN`            | `3888000` (45 days) | Total cap on refresh-chain.                                              |
| `JWT_TTL_LIFESPAN_LONG_LIVED` | `7776000` (90 days) | Long-lived assertion.                                                    |
| `JWT_TTL_EMAIL`               | `2592000` (30 days) | Unsubscribe-link tokens (long because the link sits in archived emails). |
| `JWT_TTL_MAGIC`               | `600` (10 min)      | Magic-link login.                                                        |
| `JWT_TTL_TWO_FACTOR`          | `60` (1 min)        | 2FA challenge.                                                           |
| `JWT_TTL_VERIFY`              | `60` (1 min)        | Email verification.                                                      |
| `JWT_TTL_RESET`               | `900` (15 min)      | Password-reset.                                                          |
| `JWT_TTL_MULTI_USER`          | `60` (1 min)        | Multi-user selector.                                                     |

The short windows (60–900 s) are the security-critical ones — do not raise them in production.

#### 14. Timing protection

| Var                                | Default    | Notes                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_TIMING_PROTECTION`         | `true`     | Master switch for `ensureMinimumProcessingTime` in `utils/shared/timing.ts`. **Do not disable in production** — disabling removes the response-time floor on auth, password verify, admin-token checks, and webhook-token checks, enabling timing oracles. Dev: `false` is acceptable in unit tests to keep CI fast. |
| `TIMING_PASSWORD_OPERATIONS_VALUE` | `250` (ms) | Floor used by `ensureMinimumProcessingTime` for password operations. Must be ≥ your slowest legitimate Argon2id path. If you tune Argon2 parameters, retune this so the floor does not cause every password request to wait for nothing.                                                                             |

#### 15. High-frequency entities cache

| Var                              | Default | Notes                                                                                                                                                                                  |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HIGH_FREQUENCY_USAGE_DOCUMENTS` | `false` | Toggles the documents L1/L2 short-circuits in `services/documents-cache/cache.service.ts`. Prod: `true` for any deployment serving > 1k users — documents are the highest-read entity. |

#### 16. Rate limiting

| Var                      | Default             | Notes                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RATE_LIMIT_ENABLED`     | `true`              | Per-route limits in the OpenAPI wrapper, plus the session/IP rate limiter in `services/session/session-rate-limit.service.ts`. **Strongly recommended `true` in production** — disabling removes brute-force protection on session create/refresh and login. |
| `RATE_LIMIT_FAIL_CLOSED` | `false` (fail-open) | On cache backend error, choose deny vs. allow. Fail-closed is more secure (cache outage blocks login); fail-open is more available. Pick by your compliance requirements.                                                                                    |

##### Rate-limit code paths

- The session/IP rate limiter (`services/session/session-rate-limit.service.ts:94`) short-circuits to `"allowed"` when
  `RATE_LIMIT_ENABLED=false`. With it enabled, the limiter writes a sliding-window counter to the cache; counters are not authoritative and
  a cache outage will impact them but not lose data.
- The fail-closed branch lives at `session-rate-limit.service.ts:220` — when the underlying cache call rejects, the limiter returns `deny`
  if `RATE_LIMIT_FAIL_CLOSED=true` and `allow` otherwise. The choice does **not** apply to the per-route OpenAPI limits declared in route
  files, which always run and never see the cache.
- **Cost of fail-closed:** a transient Redis or Deno-KV blip will start rejecting logins until the cache recovers. For most products this is
  fine; for high-availability consumer products, fail-open with `RATE_LIMIT_ENABLED=true` and a separate alerting path is usually the right
  tradeoff.

#### 17. Jobs and workers

| Var                   | Default | Notes                                                                                                                                                                                               |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOB_MODE`            | `none`  | `"worker"` runs `Deno.cron` inside a Web Worker (always-on server). `"inline"` runs jobs event-driven on each request (scale-to-zero friendly, e.g. Deno Deploy). `"none"` disables scheduled jobs. |
| `WORKERS_MAX_DECRYPT` | `1`     | Size of the `DecryptWorkerPool`. Raise if you see worker saturation.                                                                                                                                |
| `JOBS_MAX_CONCURRENT` | `2`     | Concurrency cap on the job worker. Tune to your CPU/IO budget.                                                                                                                                      |

##### Choosing a `JOB_MODE`

The mode controls where cron schedules are evaluated and where job bodies execute. There is no other difference in the registration APIs;
jobs are declared once in `jobs/registry.ts` and the mode decides the dispatch path (`jobs/runners/index.ts`):

| Mode       | Schedule owner                                                                            | Job body runs in                                           | Persistence model                                             | Pick this if…                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"worker"` | `Deno.cron` inside a spawned Web Worker                                                   | The same Web Worker                                        | Always-on. Instance can crash-restart; cron resumes on boot.  | You run a long-lived server (Docker, VM, k8s Deployment). **This is the standard production shape.**                                                             |
| `"inline"` | `JobScheduler.checkAndRunJobs()` called from `jobTriggerMiddleware` on every HTTP request | A shared Web Worker (the same one worker mode would spawn) | Scale-to-zero. If no request hits the instance, no job ticks. | You run on a serverless / scale-to-zero host (Deno Deploy, Cloudflare-style, PaaS that suspends idle instances). The first request after idle pays a cold-start. |
| `"none"`   | _n/a_                                                                                     | _n/a_                                                      | _n/a_                                                         | Dev. Disables the entire job subsystem — useful to keep the console clean and avoid the worker-spawn noise.                                                      |

A few code-level details that change between modes:

- `scheduler.register()` is a **no-op in `worker` mode** (jobs are registered inside the worker itself) and a real `push()` in `inline` mode
  (`jobs/services/scheduler.ts:212-244`). If you add a new job, it will work in both modes without code changes.
- `inline` mode reads `lastRun` from the cache so a cold-start instance does not fire every job on its first request — only jobs whose
  scheduled time has elapsed since `lastRun` are dispatched.
- `JOBS_MAX_CONCURRENT` is passed to the worker as `maxConcurrent` (`jobs/runners/index.ts:56`). It caps how many jobs can run inside the
  worker at once, not how many the main process can trigger. Tune to your CPU/IO budget; 2 is safe, 4–8 is appropriate on a 4-core box.
- `WORKERS_MAX_DECRYPT` is **unrelated to `JOBS_MAX_CONCURRENT`**. It is the size of the `DecryptWorkerPool` that services on-demand
  `useSymmetricDecrypt` calls from request handlers. It defaults to 1 because decryption is CPU-bound and one worker already keeps a single
  core saturated on typical payloads.

#### 18. Notifications

| Var                           | Default | Notes                                                         |
| ----------------------------- | ------- | ------------------------------------------------------------- |
| `NOTIFICATION_RETENTION_DAYS` | `30`    | Used by the `notifications-cleanup` job. 30 days is sensible. |

#### 19. Bootstrap (first-boot only)

Read by `scripts/init/bootstrap.ts` and consumed only on the very first boot when zero environments exist. Subsequent boots with
`RUN_BOOTSTRAP=true` will **bail out** (`bootstrap.ts:364`) — set `RUN_BOOTSTRAP=false` after the first install.

| Var                          | Default               | Notes                                                                                                                                                                                                                                               |
| ---------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUN_BOOTSTRAP`              | `false`               | Set to `true` for the first boot only.                                                                                                                                                                                                              |
| `BOOTSTRAP_ENV_NAME`         | `Default Environment` | Human label for the first tenant.                                                                                                                                                                                                                   |
| `BOOTSTRAP_ENV_DESCRIPTION`  | _unset_               | Optional human description.                                                                                                                                                                                                                         |
| `BOOTSTRAP_TENANT_DB_URL`    | _unset_               | libSQL/Turso URL for the first tenant DB. Dev: leave unset — falls back to a local `file:` SQLite. Prod: required.                                                                                                                                  |
| `BOOTSTRAP_TENANT_DB_TOKEN`  | _unset_               | Bearer token for the first tenant DB. Prod: required. **Critical credential.**                                                                                                                                                                      |
| `BOOTSTRAP_ADMIN_EMAIL`      | _unset_               | First super-admin email.                                                                                                                                                                                                                            |
| `BOOTSTRAP_ADMIN_PASSWORD`   | _unset_               | First super-admin password. If unset, the bootstrap script auto-generates a 32-char password and prints it to stdout. **Always set explicitly in production** to a long random value stored in your secrets manager, then rotate after first login. |
| `BOOTSTRAP_ADMIN_FIRST_NAME` | `System`              |                                                                                                                                                                                                                                                     |
| `BOOTSTRAP_ADMIN_LAST_NAME`  | `Administrator`       |                                                                                                                                                                                                                                                     |

### Dev vs. production cheat sheet

| Concern           | Dev                                                                            | Production                                                                                |
| ----------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`        | `development`                                                                  | `production`                                                                              |
| Database          | Local `file:./.data/db/*.db` (no `GLOBAL_SQLITE_URL` needed)                   | libSQL/Turso via `GLOBAL_SQLITE_URL` + `GLOBAL_SQLITE_TOKEN`                              |
| Mail              | MailHog SMTP (LAN)                                                             | Resend via `MAIL_SECRET_KEY` + verified `MAIL_FROM_EMAIL`                                 |
| Cache             | `CACHE_REDIS_ENABLED=false` (Deno KV)                                          | `CACHE_REDIS_ENABLED=true` + `CACHE_MULTI_TIER_ENABLED=true` + `CACHE_BUS_ENABLED=true`   |
| Storage           | `STORAGE_TYPE=local`                                                           | `STORAGE_TYPE=bunny` or `STORAGE_TYPE=s3`                                                 |
| Backups           | `BACKUP_ENABLED=false`                                                         | `BACKUP_ENABLED=true` (pre-flight will refuse if `STORAGE_TYPE=local`)                    |
| Rate limit        | `RATE_LIMIT_ENABLED=false`                                                     | `RATE_LIMIT_ENABLED=true`                                                                 |
| Timing protection | `ENABLE_TIMING_PROTECTION=false` (tests only)                                  | `ENABLE_TIMING_PROTECTION=true`                                                           |
| Threat intel      | `THREAT_INTELLIGENCE_ENABLED=false` (or `true` — short-circuits in dev anyway) | `THREAT_INTELLIGENCE_ENABLED=true`                                                        |
| Admin UI          | `INTERNAL_TOOL_ACTIVE=true` (token check is skipped in dev)                    | `INTERNAL_TOOL_ACTIVE=true` + `INTERNAL_TOOL_KEY=…` + `INTERNAL_TOOL_IP_RESTRICTION=true` |
| Secrets           | Commit-able placeholders are fine for non-boot-gated vars                      | All six required secrets set, ≥ 16 chars, sourced from a secrets manager                  |
| Bootstrap         | `RUN_BOOTSTRAP=true` once, then `false`                                        | `RUN_BOOTSTRAP=true` once with real `BOOTSTRAP_*` values, then `false`                    |
