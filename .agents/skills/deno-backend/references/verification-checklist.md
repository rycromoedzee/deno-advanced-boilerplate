# Verification Checklist

Walk this before submitting any code.

## Service

- [ ] Wrapped in `tracedWithServiceErrorHandling`
- [ ] Span attributes set with relevant context
- [ ] Types exported via `index.ts`
- [ ] Singleton getter in `singletons.ts`
- [ ] Permission checks performed before business logic
- [ ] Helper functions called by this service do NOT call `useLogger` (helpers throw, services log)

## Types & Interfaces

- [ ] Shared types placed in `interfaces/<domain>.ts`
- [ ] Service-internal types co-located in the service file
- [ ] API schemas in `models/` using Zod with `.trim()` and `.max()`
- [ ] No `any` in shared interfaces — use `unknown`
- [ ] `interfaces/` files only import from `@constants`, `@config`, `@deps`, `@utils`, `@interfaces`

## Database

- [ ] Using `getDB()` from `@db/index.ts` (or `getTenantDB()` / `getGlobalDB()`)
- [ ] `isActive: true` filter on user queries
- [ ] `environmentId` filter on environment-scoped data
- [ ] Queries wrapped in `traced()`

## Errors

- [ ] Using `throwHttpError` or `throwHttpErrorWithCustomMessage`
- [ ] Error keys from `@constants/errors/index.ts`
- [ ] No internal details leaked in user-facing messages
- [ ] 404 for missing/unauthorized entities (not 403)
- [ ] Zod validation messages use `withKey()` for `messageKey` embedding
- [ ] Route error response schemas use `ErrorSchema` or shared `httpResponse*` helpers (include `messageKey`)
- [ ] Services use `tracedWithServiceErrorHandling` — never bare `traced()` with manual try/catch
- [ ] Helper/utility functions never call `useLogger` in catch blocks — they throw, callers log
- [ ] Hand-rolled catch blocks check `_serviceErrorLogged` before logging a re-thrown 5xx `AppHttpException`
- [ ] Plain (non-`traced`) service methods also use `tracedWithServiceErrorHandling`, not a manual catch
- [ ] Recovered/continued failures log at `warn` (not `error`); silent `catch (_error)` logs at `warn` or is documented intentional
- [ ] Methods with custom error semantics (passthrough custom types, `critical`/security-event logging, non-500 fallback, timing-attack protection) are documented intentional exceptions

## Security

- [ ] No secrets in code — using env variables
- [ ] No sensitive data in logs or error messages
- [ ] All external input validated via Zod at the route layer
- [ ] Ownership/access verified in the service layer for client-provided IDs

## Handler

- [ ] Using `defineHandler` factory
- [ ] `entityType` + `loggerSection` set in config
- [ ] `responseSchema` set for all JSON endpoints (omit only for 204/stream/download/HTML)
- [ ] Returns `{ data: {...}, status: xxx }`
- [ ] Timing profile configured when appropriate
- [ ] No manual response object construction — let `responseSchema.parse()` shape the output

## Route

- [ ] Using `createRoute` with Zod schemas
- [ ] Standard HTTP response helpers included
- [ ] OpenAPI tags assigned
- [ ] String inputs use `.trim()` and `.max()` matching DB constraints

## Multi-Tenancy / Caching

- [ ] No query or cache read runs without an `environmentId` scope
- [ ] Every tenant-scoped cache key is prefixed with `environmentId` (never bare entity ids)
- [ ] A missing `environmentId` throws — no `?? "unknown"` fallback
- [ ] Cache invalidation is called after write completion (see `references/caching.md`)
- [ ] `Cache-Control: private` used for tenant-protected HTTP responses

## Dependencies

- [ ] No bare `npm:`/`jsr:`/`https:` specifiers in feature code — all via `@deps`
- [ ] New packages added to `deno.json` import map with pinned versions and re-exported from `deps.ts`
- [ ] `deno run --allow-read .agents/skills/deno-backend/scripts/verify_deps.ts` passes

## Permissions

- [ ] No `--allow-all` / `-A` added to any task or entrypoint
- [ ] New file/net/env access uses the narrowest possible scope
- [ ] Tenant DB path is constructed via a validated, `resolve()`-checked builder (not raw string concat)

## Code Standards

- [ ] `deno fmt` — no formatting diff
- [ ] `deno lint` — zero warnings
- [ ] `deno check main.ts` — no type errors
- [ ] Explicit return types on all exported functions
- [ ] No `any` in shared code; `unknown` + narrowing used instead
- [ ] kebab-case filenames with dotted type-suffix (e.g. `feature-name.service.ts`)
