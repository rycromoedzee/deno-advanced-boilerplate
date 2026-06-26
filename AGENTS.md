# AGENTS.md

Guidance for AI coding agents working in this repository.

## Skills

This project ships a unified backend skill in **`.agents/skills/deno-backend/`**. Load it for any backend task:

- **`deno-backend`** — `.agents/skills/deno-backend/SKILL.md` Load for **any** task that writes, reviews, or modifies backend code: routes,
  handlers, services, models, interfaces, DB access, error handling, validation, tests, tenant DB isolation, permission flags, dependency
  imports, caching layers, or query performance. It is the authority on the layered architecture (Route → Handler → Service → Database), the
  locked naming decisions D1–D8, response-DTO shaping, traced/error-handled services, `messageKey` error conventions, secure-by-default
  practices, tenant isolation, least-privilege permissions, and centralized dependency management.

  Reference files (read the matching one before editing):

  _Writing code in a layer:_
  - `references/layer-patterns.md` — service/handler/route/response-DTO patterns
  - `references/database.md` — Drizzle ops + critical `isActive`/`environmentId` filters
  - `references/error-handling.md` — `throwHttpError`, `messageKey`, `withKey()`, 404 rule
  - `references/security.md` — input validation, timing protection, permission checks
  - `references/types-and-interfaces.md` — where each type belongs
  - `references/file-structure.md` — feature-folder rules, naming, D1–D8
  - `references/testing.md` — `tests/` layout & seam discipline
  - `references/verification-checklist.md` — pre-submit checklist

  _Isolation / perf / deps / permissions:_
  - `references/multitenancy.md` — per-tenant DB lifecycle & isolation
  - `references/caching.md` — tenant-scoped cache keys & invalidation
  - `references/permissions.md` — least-privilege Deno flags, DB-path safety
  - `references/dependency-management.md` — `deps.ts` / import-map policy
  - `references/code-standards.md` — fmt/lint/check, conventions, verified project-wins
  - `scripts/verify_deps.ts` — CI gate: fails if imports bypass `@deps`

  Each reference ends with a verified `## Project-Specific Context` section — trust those facts over generic examples. A prioritized fix
  list lives in `plans/backend-remediation-backlog.md`.

## Project facts an agent must know

- **Stack:** Deno + Hono + Drizzle ORM over **libSQL/Turso** (not raw SQLite).
- **Multi-tenancy:** one database per **environment** (the tenant). The tenant id is **`environmentId`** (a CUID2), derived server-side from
  a validated JWT or API key and carried via `AsyncLocalStorage` (`db/context.ts`, `middleware/auth.ts`). Never read it from a
  user-controlled body/param.
- **DB access:** go through `getTenantDB(environmentId?)` / `getGlobalDB()` in `db/db.ts`. Queries are parameterized via Drizzle — never
  write raw/concatenated SQL.
- **Caching:** 3-tier (in-memory L1 → Redis/Deno KV L2) behind one global singleton in `services/cache/`. Every tenant-scoped cache key MUST
  be prefixed with `environmentId`.
- **Dependencies:** import third-party modules only via `@deps` (`deps.ts`). Do not add bare `npm:`/`jsr:`/`https:` specifiers in feature
  code.
- **Conventions:** kebab-case `*.type.ts` filenames; route `index.ts` files use `export default`; error handling is throw-based via
  `throwHttpError(<key>)`.

## Verifying changes

```sh
deno fmt
deno lint
deno check main.ts
deno run --allow-read .agents/skills/deno-backend/scripts/verify_deps.ts
```
