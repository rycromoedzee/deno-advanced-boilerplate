# File Structure

**Every feature is a folder, in every layer, with an `index.ts`.** Files mirror
each other across layers so a feature's pieces are mechanically discoverable.
For every `<x>.route.ts` there is a matching `<x>.handler.ts`.

```
services/feature-name/
  ├── index.ts                       # barrel: classes, singleton getters, types
  ├── singletons.ts                  # lazy getters (feature services)
  ├── feature-name-create.service.ts
  ├── feature-name-list.service.ts
  ├── feature-name-delete.service.ts
  └── feature-name.helper.ts

handlers/feature-name/
  ├── index.ts                       # BARREL: re-exports every handler in the folder
  ├── feature-name.handler.ts        # mirrors feature-name.route.ts
  └── <aspect>.handler.ts            # mirrors <aspect>.route.ts (e.g. sharing.handler.ts)

routes/feature-name/
  ├── index.ts                       # WIRING module: builds the OpenAPIHono sub-app, pairs each
  │                                  #   route with its handler, applies rate limits, exports default.
  │                                  #   This is a deep module — NOT a barrel.
  ├── feature-name.route.ts          # single-aspect file, named after the FEATURE
  └── <aspect>.route.ts              # extra aspects when a feature has several

models/feature-name/
  ├── index.ts
  └── feature-name.model.ts

interfaces/
  └── feature-name.ts                # Shared types used across layers (flat, no folder)

db/schema/
  └── feature-name.ts
```

## Feature-folder rules

1. **Symmetry.** Every `<x>.route.ts` has an `<x>.handler.ts` with the same stem. `sharing.route.ts` ↔ `sharing.handler.ts`.
2. **File named after the feature** for single-aspect features: `routes/documents-stats/documents-stats.route.ts` (not `stats.route.ts`). Pattern: `routes/<x>/<x>.route.ts` + `handlers/<x>/<x>.handler.ts`.
3. **No `handlers.ts`.** Split per aspect into `<aspect>.handler.ts`.
4. **Routes import handlers via the barrel only:** `import { ... } from "@handlers/<feature>/index.ts"` — never deep file paths.
5. **Always a folder + `index.ts`,** even for single-file features. No loose root files.
6. **Two kinds of `index.ts`:** the **route** `index.ts` is a wiring module (deep — don't collapse it into `main.ts`); the **handler/service/model** `index.ts` is a barrel.
7. **1:1 route↔handler is the default;** operation-heavy domains (e.g. `permissions`, `auth`) may keep finer-grained route files than handler files when an operation is a thin one-liner — document the divergence in the feature's `index.ts` header.

## Naming

| Type | Pattern | Example |
| ---- | ------- | ------- |
| Service file | `feature-operation.service.ts` | `notification-create.service.ts` |
| Service class | `FeatureOperationService` | `NotificationCreateService` |
| Handler file | `<aspect>.handler.ts` | `notes.handler.ts`, `sharing.handler.ts` |
| Route file | `<aspect>.route.ts` | `notes.route.ts`, `sharing.route.ts` |
| Route path | `/kebab-case` | `/notification-preferences` |
| Model file | `<feature>.model.ts` | `notification.model.ts` |
| Middleware file | `<name>.middleware.ts` | `auth.middleware.ts` |
| Interface file | `<domain>.ts` in `interfaces/` | `interfaces/auth.ts` |
| Interface name | `IFeatureName` (prefixed `I`) | `IUserLookupResult` |
| Enum name | `PascalCase` | `FeatureStatus`, `ErrorSeverity` |

## `jobs/` vs `services/background-jobs/` (distinct — do not merge)

Two separate subsystems that look related but solve different problems:

- **`jobs/`** — **scheduled job definitions.** Cron-driven: `*.job.ts` files each
  define one scheduled job, `registry.ts` is the single source of truth wiring them,
  `services/scheduler.ts` + `runners/` (`worker.ts`/`standalone.ts`) decide *when* to
  fire them (Deno.cron in a worker, or event-driven inline for scale-to-zero), and
  `services/job-lock.service.ts` + `job-state.service.ts` guard against double-runs and
  persist last-run timestamps. Examples: `refresh-token-cleanup`, `trace-cleanup`,
  `threat-intel-*`, `db-backup`. Time-based, periodic.
- **`services/background-jobs/`** — **on-demand task-execution engine.** The async
  work queue: `task-enqueue/cancel/status.service.ts` are the runtime services
  (DB-backed, cache read-through), `handlers/` is the registry of discrete task
  *types*, `providers/cache-queue.provider.ts` is the queue, `base-task-handler.ts`
  + `utils/cancellation-token.ts` support cancellation. Triggered on demand, not by a
  clock. See `services/background-jobs/README.md`.

Both are legitimate; the duplication is only nominal. Keep them separate.

## Locked decisions (D1–D8)

| #  | Decision | Convention |
| -- | -------- | ---------- |
| D1 | Handler files | `<aspect>.handler.ts` mirroring the route files; every handler dir has a barrel `index.ts`. `handlers.ts` and bare `*.ts` are retired. Single-aspect features use `<feature>.handler.ts`. 1:1 with routes by default; operation-heavy domains may diverge (documented exception). |
| D2 | Route files | `routes/<feature>/` folder + `index.ts` wiring module + `<feature>.route.ts` (+ `<aspect>.route.ts`). No nested dirs, no bare `route.ts`, no loose root route files. |
| D3 | Model files | `<feature>.model.ts`; every model dir has a meaningful `index.ts` (no empty stubs). |
| D4 | Service dir shape | Every feature service dir has `index.ts` + `singletons.ts`; files are `<feature>-<operation>.service.ts`. Infra-only dirs (`logger`, `tracing`, `cache`, `workers`, `shared`, `mailer`, `token`, `public-access`, `db-backup`) are documented exceptions and need no `singletons.ts`. |
| D5 | Non-`*.service.ts` roles | Permitted role suffixes inside `services/<feature>/`: `*.repository.ts`, `*.provider.ts`, `*.adapter.ts`, `*.processor.ts`, `*.validator.ts`, `*.strategy.ts`, `*.creator.ts`, plus `*.helper.ts` and co-located `types.ts`. Don't invent new ones. |
| D6 | Middleware files | `*.middleware.ts`. |
| D7 | Errors tree | One tree: `constants/errors/` holds error keys, encryption/tracing error helpers, and shared error types. There is **no separate `errors-service/`** directory. |
| D8 | Branding | Generic boilerplate ("Deno Advanced Boilerplate"); the legacy "Moedzee" product name is removed from docs and standards. Code identifiers unchanged until deliberately renamed. |

### Service-internal role files (allowed taxonomy)

Inside `services/<feature>/`, beyond `*.service.ts`/`*.helper.ts`, these role
suffixes are permitted when they describe a real role (don't invent new ones):
`*.repository.ts`, `*.provider.ts`, `*.adapter.ts`, `*.processor.ts`,
`*.validator.ts`, `*.strategy.ts`, `*.creator.ts`. Service-internal types may
live in a co-located `types.ts`. Infra-only service dirs (`logger`, `tracing`,
`cache`, `workers`) may omit `singletons.ts`.

## Reference implementations (gold standard)

- **Services**: `services/environment-config-notifications/`
- **Handlers**: `handlers/notifications/` (barrel `index.ts` + `*.handler.ts`)
- **Routes**: `routes/notifications/` (`index.ts` wiring + `*.route.ts`)
- **Models**: `models/notifications/notification.model.ts`
- **Interfaces**: `interfaces/auth.ts`, `interfaces/cache.ts`
