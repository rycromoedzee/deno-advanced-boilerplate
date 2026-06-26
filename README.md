# Deno Advanced Boilerplate

A multi-tenant, security-first backend boilerplate built with **Deno + Hono + Drizzle ORM + Zod**. It provides a layered, traceable,
production-shaped API scaffold intended as a starting point for security-conscious multi-tenant services — the kind of work that is normally
rebuilt from scratch on every new project is already wired up, hardened, and documented here.

A scaled back version of a self hosted application I have been making for testing encryption and auth. Built out an agent skill on top of the existing project and had it reverse engineer the logic into what is now this repo.

The defining design choice is **one database per tenant**: each environment (the tenant, identified by an `environmentId` CUID2 derived
server-side from a validated JWT or API key) gets its own isolated database, while a global database holds the tenant registry, user
records, and encrypted tenant-DB credentials. Every layer — caching, backups, jobs, tracing — is tenant-aware by construction.

## Features

- **Authentication & sessions** — Argon2id password hashing with a server-side pepper (online pepper rotation supported), Ed25519-signed
  JWTs, signed refresh-token cookies, passkeys/WebAuthn, TOTP 2FA, magic links, email verification, and API keys.
- **Multi-tenant isolation** — per-tenant libSQL/Turso databases with an LRU-bounded connection pool, plus a global registry DB. Tenant
  identity is never read from a user-controlled body or param.
- **Encrypted storage** — pluggable providers (`bunny`, `s3`, `local`) with application-side per-file symmetric encryption before upload.
- **3-tier caching** — in-process L1 → Redis/Deno KV L2 with a Redis Pub/Sub cache bus for cross-instance L1 invalidation. Every
  tenant-scoped key is namespaced by `environmentId`.
- **Backups & DR** — GFS-retention database backups and an independent off-site object-storage copy (the 3-2-1 leg) with fail-closed
  pre-flight guards.
- **Security middleware** — IP-based threat intelligence, sliding-window rate limiting (fail-open or fail-closed), and response-time floors
  for timing-attack protection.
- **Jobs & workers** — cron-style scheduled jobs that run in a Web Worker (`worker`), event-driven per request (`inline`), or disabled
  (`none`).
- **Observability** — structured logging (BetterStack in production, stdout in dev) and span-based tracing with error breadcrumbs.
- **Schema-first API** — Zod schemas generate the OpenAPI spec, which generates consumer TypeScript types, so docs, spec, and types cannot
  drift.
- **Internal admin UI** — a guarded `/internal/__admin` surface for browsing tenants and running admin operations.

## Stack

- **Runtime:** Deno
- **Web framework:** Hono (with `@hono/zod-openapi` for OpenAPI generation)
- **ORM:** Drizzle
- **Validation:** Zod
- **Database:** SQLite/libSQL (primary). The live client in `db/db.ts` is constructed via `drizzle-orm/libsql` + `@libsql/client`
  (`LibSQLDatabase`), using local file-based SQLite in development (`file:./.data/db/*.db`) and a remote libSQL URL in other environments.

> Note: `deno.json` also declares `drizzle-orm/node-postgres` + `pg` dependencies, but `db/db.ts` does not instantiate a Postgres client;
> the live runtime DB is SQLite/libSQL.

## Quickstart

```sh
# 1. Configure environment (copy the sanitized template and fill in real values)
cp .env.example .env

# 2. Run in watch mode
deno task dev
```

Required secrets are validated at startup (see `config/env.ts`); the app throws on launch if any are missing outside of `NODE_ENV=test`.

## API documentation & generated types

The API contract is schema-first: Zod schemas generate the OpenAPI spec, which generates consumer TypeScript types — so the docs, spec, and
frontend types can't drift. While the server runs, browse the docs at `/openapi` (Scalar) or fetch the JSON at `/docs`. To add/change an
endpoint, regenerate consumer types, or run the docs/anti-drift gates, see **[docs/openapi-and-types.md](docs/openapi-and-types.md)**.

## Configuration

All runtime configuration is loaded by `config/env.ts` from a `.env` file in the project root. The full, deep-dive reference for every
environment variable — required boot-time secrets, defaults, dev/prod guidance, the dev-vs-production cheat sheet, and the per-section
gotchas — lives in **[docs/configuration.md](docs/configuration.md)**.

Start by copying the sanitized template and filling in real values:

```sh
cp .env.example .env
```

The six required secrets are validated at startup; when `NODE_ENV !== "test"` the app throws on launch if any is missing or shorter than 16
trimmed characters. See [docs/configuration.md](docs/configuration.md#required-secrets-boot-time-gate) for the list and generators.

## Quality gates

```sh
deno fmt --check       # formatting (140-char width)
deno lint              # Deno linter
deno check main.ts     # type-check the entrypoint
deno task lint:eslint  # project ESLint rules (handlers, services, middleware, utils, constants)
```

All four are expected to pass on a clean tree.

## Architecture

The codebase follows a strict layered flow — never bypass layers or mix concerns:

```
Route (OpenAPI + Zod) → Handler (defineHandler) → Service (business logic) → Database (Drizzle ORM)
```

- **Routes** (`routes/`) define API contracts: OpenAPI schemas, Zod validation, and HTTP response shapes.
- **Handlers** (`handlers/`) orchestrate: extract request context, call services, and return responses via `defineHandler`.
- **Services** (`services/`) hold business logic — permission checks, database operations, and error handling — wrapped in
  `tracedWithServiceErrorHandling` for observability and consistent error propagation.
- **Database** (`db/`) uses Drizzle ORM with traced queries and per-tenant connection management.

Code is organized into feature folders so each feature owns its route, handler, service, and model files together.

## License

[MIT](LICENSE) — free to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of this software. See
[`LICENSE`](LICENSE) for the full text.
