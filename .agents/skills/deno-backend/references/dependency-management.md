# Dependency Management

## The Single Rule
Every third-party module is imported in `deps.ts` and re-exported. Feature
code imports from `deps.ts` (or a domain-specific `deps` file), never directly.

## deno.json (import map + pinned versions)
```jsonc
{
  "imports": {
    "@db/sqlite": "jsr:@db/sqlite@0.12.0",
    "@std/cache": "jsr:@std/cache@0.1.3",
    "@std/assert": "jsr:@std/assert@1.0.6",
    "zod": "npm:zod@3.23.8"
  },
  "tasks": {
    "dev": "deno run --watch --allow-read=./data --allow-write=./data --allow-net=0.0.0.0:8000 src/main.ts",
    "check": "deno fmt --check && deno lint && deno check src/main.ts",
    "verify:deps": "deno run --allow-read scripts/verify_deps.ts"
  },
  "lock": true
}
```

## deps.ts (the only place specifiers appear)

```ts
// Re-export with explicit, named bindings. Group by concern.
export { Database } from "@db/sqlite";
export { LruCache } from "@std/cache";
export { z } from "zod";
export type { ZodSchema } from "zod";
```

## Usage in feature code

```ts
import { Database, z } from "../deps.ts";
```

## Why

- One file to audit for supply-chain review.
- One file to bump versions; `deno.lock` enforces integrity.
- Grepping `deps.ts` reveals the full dependency surface instantly.

## Project-Specific Context (verified 2026-06-14)

All facts below were observed by reading code. The skill's example stack
(`@db/sqlite`, `@std/cache`, `zod`) does **not** match this project. The real
stack is **Drizzle ORM over libSQL/Turso** (`deps.ts:16-45`), Hono, and noble
crypto.

### What exists and where
- `deps.ts` exists at repo root (`/deps.ts`, 102 lines) and is aliased as
  `@deps` in the import map (`deno.json:50`).
- `deno.json` has an import map with path aliases (`@services/`, `@db/`, etc.)
  and pinned npm/jsr versions (`deno.json:2-59`).
- `deno.lock` exists (~135 KB at repo root).
- There is **no `src/` directory.** Top-level source dirs are: `config`,
  `constants`, `db`, `handlers`, `interfaces`, `jobs`, `libs`, `middleware`,
  `models`, `routes`, `services`, `utils` (+ `main.ts`, `deps.ts`).
