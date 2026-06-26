# Deno Permissions — Least Privilege

## Principle

Grant the narrowest permission scope that lets the feature work. Tenant DBs
live under a single, known directory so filesystem permissions can stay scoped
and a tenant id can never escape it via path traversal.

## Production run command (target shape)

```sh
deno run \
  --allow-read=./data,./config \
  --allow-write=./data \
  --allow-net=0.0.0.0:8000 \
  --allow-env=APP_PORT,DB_DIR \
  --no-prompt \
  src/main.ts
```

Some native drivers (e.g. the libSQL native client) and worker spawning require
`--allow-ffi` / `--allow-run` / `--allow-sys`. Add them only when proven
necessary, and prefer scoping over breadth everywhere it is supported.

## Rules

- ❌ Never `--allow-all` / `-A`. Never unscoped `--allow-read` / `--allow-write`.
- ✅ Scope `--allow-read` / `--allow-write` to the DB directory + config only.
- ✅ `--allow-env` lists exact variable names (no bare `--allow-env`).
- ✅ `--allow-net` is scoped to the listen host:port (and explicit egress hosts).
- ✅ `--no-prompt` in prod so a missing permission fails loudly, never hangs
  waiting on an interactive grant.
- ✅ The DB directory MUST be a single validated constant (`DB_DIR`), resolved
  at startup, so a tenant id can never escape it via `../` traversal.

## Path-traversal guard (required)

```ts
import { join, resolve } from "../deps.ts";

const DB_DIR = resolve(Deno.env.get("DB_DIR") ?? "./data");

export function tenantDbPath(accountId: string): string {
  if (!/^[a-z0-9-]{6,64}$/.test(accountId)) {
    throw new Error("Invalid accountId");
  }
  const path = resolve(join(DB_DIR, `${accountId}.db`));
  if (path !== DB_DIR && !path.startsWith(DB_DIR + "/")) {
    throw new Error("Path traversal blocked");
  }
  return path;
}
```

Even when the tenant id is server-derived and structurally safe (e.g. a CUID2),
keep this guard as defense in depth — it costs nothing and documents intent.

## Project-Specific Context (verified 2026-06-14)

The skill's prescribed scoped run command does not match this project today.
Verified facts:

### How the app actually runs
- **Production entrypoint is `start.sh`** (port 55555). It runs bootstrap then
  `deno serve` with broad, **unscoped** flags (`start.sh:8,12`):
  `--allow-read --allow-write --allow-net --allow-env --allow-sys --allow-run
  --allow-ffi` (+ `--unstable-kv --unstable-cron --unstable-worker-options`).
- **`deno.json` tasks use `--allow-all`**: `dev` (`deno.json:61`),
  `dev:inline` (`:62`), `start` (`:63`), `start:inline` (`:64`),
  `jobs:standalone` (`:65`). The `drizzle-kit` task family uses `-A`
  (`:66-77`).

### How the DB directory is resolved
- **Local dev:** hardcoded relative dir `./.data/db/`. Global DB is
  `file:./.data/db/global.db` (`db/db.ts:62`); tenant DBs are
  `` file:./.data/db/${dbShortCode}${environmentId}.db `` (`db/db.ts:156`),
  where `dbShortCode` defaults to `"MODZ"` (`config/env.ts:26`,
  env `DATABASE_SHORT_CODE`).
- **Production:** per-tenant encrypted libSQL/Turso URLs + auth tokens stored
  in the `environmentSqliteRegistry` global table, fetched and decrypted at
  connection time (`db/db.ts:160-163,188-219`). Relevant env vars:
  `GLOBAL_SQLITE_URL`, `GLOBAL_SQLITE_TOKEN`, `AUTH_GENERAL_ENCRYPTION_KEY`,
  `MAX_TENANT_CONNECTIONS` (`config/env.ts:24-31,89`).

> ⚠️ Current gap: `--allow-all` is never acceptable per skill Rule 2. Both
> `deno.json` tasks and `start.sh` violate least-privilege. Target state: scope
> `--allow-read`/`--allow-write` to the DB + config dirs, enumerate
> `--allow-env` to the exact vars in `config/env.ts`, and add `--no-prompt`.
> Note `--allow-ffi`/`--allow-run`/`--allow-sys` are likely required by the
> native libSQL driver and worker spawning — verify before removing.
> **ASSUMPTION — needs confirmation** of the minimal flag set the libSQL native
> client + job workers actually require.

> ⚠️ Current gap: There is **no `DB_DIR` constant validated at startup**. The
> local-dev dir is a string literal repeated at `db/db.ts:62,156`,
> `jobs/db-backup.job.ts:72,81`, `scripts/init/bootstrap.ts:141`,
> `db/push-schemas.ts:121,147`. Target state: a single validated, resolved
> `DB_DIR` consumed everywhere.

> ⚠️ Current gap: No path-traversal guard or `environmentId` format check
> exists at the DB-path construction sites (`db/db.ts:156` et al). Mitigant:
> `environmentId` is a CUID2 (`[a-z]` + base36, no `/` or `.` —
> `utils/database/id-generation/common.ts:12-15`) and is server-derived from a
> validated JWT/registry entry, so practical traversal risk is low. Target
> state: add a format-validating, `resolve()`-checked path builder regardless,
> as defense in depth.
