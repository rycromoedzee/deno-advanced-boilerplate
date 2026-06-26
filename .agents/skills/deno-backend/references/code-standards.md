
# Code Standards

## Tooling (enforced in CI via `deno task check`)
- `deno fmt` — formatting is not a debate.
- `deno lint` — zero warnings.
- `deno check` — strict type checking, no errors.

## Project-Specific Context (verified 2026-06-14)

Several generic skill conventions diverge from this project's established,
internally consistent conventions. Where the project's convention is deliberate
and consistent, follow the project, not the generic rule.

### Conventions actually in use (project wins where consistent)
- **Naming:** kebab-case with a dotted type-suffix —
  `tenant-context.middleware.ts`, `login.handler.ts`, `magic-link.service.ts`.
  (Supersedes any snake_case convention for this repo.) Types/classes are
  `PascalCase`.
- **Exports:** named exports for business logic; `export default` is reserved
  for route `index.ts` mounting (31 occurrences, e.g. `routes/user/index.ts:178`)
  and a few singleton utils (e.g. `utils/auth/cache-keys.ts:233`). This
  supersedes any "named exports only" rule for route entrypoints.
- **Error handling:** **throw-based**, not Result-style. Canonical idiom is
  `throwHttpError(<errorKey>)` (163 call sites) layered over Hono
  `HTTPException`. No `Result<T, E>` type exists — do not introduce one without
  team buy-in. A custom ESLint rule `no-static-custom-http-error-message`
  (`eslint.config.mjs`, `eslint-rules/`) enforces keyed (non-static) error
  messages. See `references/error-handling.md`.
- **DB-touching function signatures** do **not** universally lead with
  `accountId`/`environmentId` — tenant scope is carried implicitly via
  `AsyncLocalStorage` (`db/context.ts`) and `getTenantDB()`.

### Already compliant (do not re-litigate)
- Explicit return types on exported functions are pervasive (convention, not
  tool-enforced). ✅
- `deno fmt` config is broad (`fmt.exclude` only `.agents/`, `.claude/`;
  lineWidth 140). ✅
- Custom ESLint rule enforces keyed errors. ✅
