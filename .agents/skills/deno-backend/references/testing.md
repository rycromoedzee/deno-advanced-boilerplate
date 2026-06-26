# Testing

Tests live in `tests/` (the `@tests/` import alias), run via configured tasks:

- `deno task test` — all tests
- `deno task test:unit` — unit tests only (`tests/unit/`)
- `deno task test:integration` — integration tests only (`tests/integration/`)
- `deno task test:coverage` — all tests with coverage

## Layout

```
tests/
  ├── unit/             # pure, no DB / no network — fast, deterministic
  │   └── utils/        # mirrors utils/ structure
  └── integration/      # the layered stack wired end-to-end
      └── handlers/     # mirrors handlers/ structure
```

## Conventions

- **File naming:** `*.test.ts`, under `tests/unit/...` or `tests/integration/...`
  mirroring the source path of what they cover.
- **Unit tests** cover pure utilities and domain logic behind a small interface
  — security-critical helpers (`utils/shared/timing.ts` `safeEqual` /
  `constantTimeMultiCompare`), id-generation, the MIME catalog, IP validation,
  `utils/validation/zod-message-key.ts` (`withKey` / `parseMessageKey`), and
  `CommonPasswordFilter` with an injected fixture. No DB, no network.
- **Integration tests** exercise one `defineHandler` route end-to-end
  (route → handler → service → DB) against the local SQLite/libSQL substitute,
  proving the layers wire up and the `responseSchema` output contract holds.
- **Seam discipline:** pure in-process utilities are tested directly through
  their interface. Only utilities with an external dependency (file path, clock,
  network) get an injected seam so they're testable — never add a port/adapter
  speculatively (only where two adapters — prod + test — are justified).

> Note: tests run with `--no-check` and `tests/` is excluded from `deno lint`
> (see `deno.json`). The remediation backlog (`plans/backend-remediation-backlog.md`)
> flags this as a standards gap — don't rely on the test task to catch type errors.
