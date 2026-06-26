# OpenAPI Documentation Standard

The single source of truth for how every route operation is documented. The
rendered spec (served at `GET /docs`, Scalar UI at `GET /openapi`) is a public
contract — frontend devs, integrators, and auditors read it to understand the
API. **Docs are metadata: edits here must never change route registration order
or runtime behavior.**

Apply this mechanically to every `createRoute({...})` in `routes/**`. The
`scripts/check-openapi-docs.ts` gate (see §Verification) enforces it in CI, so
undocumented operations fail the build.

---

## Confirmed feature surface (`@hono/zod-openapi` 1.4.0)

Verified against the installed `RouteConfig`
(`@asteasolutions/zod-to-openapi` 8.5.0, which types `RouteConfig` as
`Omit<OperationObject, 'responses'> & {...}`). All standard OpenAPI 3.0
operation fields pass straight through `createRoute({...})` into the spec — no
workarounds needed:

**Operation-level** (top-level keys of the `createRoute({...})` object):

| Field | Required | Notes |
| --- | --- | --- |
| `method`, `path` | yes | Already present. |
| `tags` | yes | Use an `OpenAPITags.*` constant; never a raw string. |
| `summary` | **yes** | See §summary. |
| `description` | **yes** | See §description (the primary lever of this standard). |
| `operationId` | **yes** | See §operationId. |
| `security` | when non-default | See §security. |
| `deprecated` | when retiring | `deprecated: true` + name the replacement in `description`. |
| `externalDocs` | optional | `{ url, description }` — link a README section for deep flows. |
| `request.body/params/query/headers/cookies` | as needed | Already used. `request.headers`/`cookies` document required ones. |
| `responses[status]` | yes | `description` per status + `headers` where meaningful (e.g. `Set-Cookie`, `Retry-After`). |

**Schema-level** (`.openapi(...)` on Zod types in `models/**`):

- `.openapi("ComponentName")` registers a **named reusable component** (clean
  `$ref`s). Keep names unique per feature: `NoteCreateRequest`,
  `DocumentCreateRequest` — never a bare generic name. (Notes already registers
  ~39; other domains are mostly inline — leave that as-is, don't mass-refactor.)
- `.openapi({ description, example })` on fields.
- Media-type objects support **both** `example:` (single) **and** an `examples:`
  map (named variants): see §examples.

---

## summary

Imperative, **≤ ~60 characters**, and **precise to the HTTP method** — it labels
the operation in the sidebar and the generated client method tooltip.

- ✅ `Create note` · `List document folders` · `Mark a notification as read` ·
  `Refresh session` · `Delete API key`
- ❌ `notes` (not a verb) · `This endpoint creates a new note in the system and
  returns it` (too long) · `Handle document` (imprecise) · `Get data` (vague)
- Every operation **must** have a `summary`. If a route is missing one, add it.

Keep existing good summaries; only rewrite terse/vague ones. Don't lengthen them.

---

## description

Markdown, **required for every operation**. Write it from the **real behavior**
read out of the handler + service(s) — not the path. Use this template (omit a
section only when it genuinely does not apply; never leave all of them out):

```
<One or two sentences: what this does and why it exists.>

**Behavior:** <what it does, side effects, async/queued work, what is mutated>
**Auth:** <cookie session | API key | super-admin | internal tool | public>
**Permissions:** <permission group / ownership checks, or "none beyond auth">
**Notes:** <tenant scoping, rate limits, idempotency, pagination, caching, etc.>
```

Rules:

- Lead with purpose. A reader should know *why* this endpoint exists after the
  first sentence.
- `**Auth:**` is **required** — name the posture honestly (see §security).
- For multi-shape inputs, **enumerate the variants** here and point at the named
  examples (see §examples).
- Keep it tight — 3–8 lines. This is a reference, not an essay.
- For flows with steps (passkey/two-factor/magic-link), describe where this
  operation sits in the sequence.

### Contract vs. prose (non-negotiable)

> **`description` explains _why / when / how_ only. It MUST NOT restate the
> contract** — field shapes, types, required-ness, enum values, or formats.
> Those live in the Zod schema (`models/`) and are the single source of truth;
> the OpenAPI document is generated from Zod, so re-stating the shape in prose
> creates a lossy copy that will drift.

If a field needs explanation, put it on the Zod field with
`.openapi({ description })` so it travels with the type — not in the operation's
Markdown body.

- ✅ "Queues a thumbnail render; the document must be an image or PDF. Rate
  limited to 10/min per environment."
- ❌ "Body: `{ documentId: string (required), width: number, format: 'png'|'webp' }`."
  (That is the schema's job — it is already in the generated spec/types.)

Enumerating the *variants* of a multi-shape input and *when to use each* is fine
(the "when"); re-listing their fields/types is not.

Example (gold-standard shape):

```ts
export const listNotificationsRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List notifications for current user",
  description: `Returns a paginated list of inbox notifications for the authenticated user.

**Behavior:** Reads from the tenant-scoped notification table; newest first.
**Auth:** cookie session.
**Permissions:** none beyond auth — scoped to the caller's own inbox.
**Notes:** Use \`?unreadOnly=true\` to filter. Results are tenant-scoped.`,
  operationId: "notificationsList",
  tags: [OpenAPITags.notifications],
  // ...
});
```

---

## operationId

**Required, stable, unique across the whole spec.** Drives generated-client
method names, so it must not churn.

- Scheme: **`<featureCamel><Action>`** in `camelCase`.
  - `notesList`, `notesCreate`, `noteGet`, `noteUpdate`, `noteDelete`.
  - `documentFoldersBulkMove`, `userApiKeysCreate`, `authTwoFactorVerify`.
- `<Action>` is a clear verb/object: `List`, `Create`, `Get`, `Update`,
  `Delete`, `BulkMove`, `Upload`, `Download`, `Verify`, `Stream`, `Count`.
- **Unique globally** — the CI gate fails on collisions. Within a feature the
  feature-prefix makes this automatic; double-check cross-feature overlaps
  (e.g. only one `healthGet`).
- Preserve any pre-existing `operationId` you find; don't rename.

---

## security

The global spec default is `[{ cookieAuth: [] }, { apiKeyAuth: [] }]` (a locked
icon). Override **only** when the operation's real posture differs, so the
Scalar lock icon is accurate:

- **Truly public** (no auth consumed — login, register, magic-link verify, public
  share download, CSP report, health, webhook receivers): add `security: []`.
- **Internal tool** (mounted under `/api/internal`, guarded by
  `internalToolKeyAuth` — the admin-ui visualizers): add
  `security: [{ internalToolKeyAuth: [] }]`.
- **Super-admin guarded** (`/api/super-admin/*`, `superAdminGuardMiddleware`):
  auth is still a cookie session, so keep the default and state
  `**Auth:** super-admin (cookie session)` in `description`. Do not invent a new
  scheme.
- **Everything else:** omit `security` and inherit the locked default.

Determine posture by reading the handler/middleware, not by guessing from the
path. The mount map (from `main.ts`):

| Mount | App | Auth posture |
| --- | --- | --- |
| `/api/auth`, `/` (csp-report) | `publicOpenApiApp` | mixed — most public |
| `/api/*` (user, documents, notes, notifications, jobs, permissions, media, env-config, debug, super-admin) | `privateOpenApiApp` | cookie/api-key |
| `/api/internal/*` (admin-ui) | `privateInternalOpenApiApp` | internal tool key |
| `/` (health), `/api/webhooks` | root `app` | public |

---

## examples

**Every request-body schema and key response schema carries at least one
realistic `example`**, registered on the field via
`.openapi({ description, example })` in `models/**` (preferred) or on the whole
schema. Examples must be realistic and internally consistent (valid UUID/CUID2
ids, plausible values) — never `"string"`, `0`, or `true` placeholders.

- **Field-level (default):**
  `id: z.string().openapi({ description: "Notification id", example: "abc123..." })`.
- **Multi-shape inputs** (union / discriminated bodies, endpoints that accept
  different variants, polymorphic responses): model as `z.discriminatedUnion`
  (preferred, renders `oneOf` + discriminator) or `z.union`, and attach a
  **named `examples` map** on the media type — one entry per variant, each with
  `summary` + complete `value`:

  ```ts
  request: {
    body: {
      content: {
        "application/json": {
          schema: SchemaBulkMoveRequest,
          examples: {
            byFolderIds: {
              summary: "Move documents into a folder",
              value: { documentIds: ["doc_1", "doc_2"], targetFolderId: "fld_3" },
            },
            toRoot: {
              summary: "Move documents out of any folder (to root)",
              value: { documentIds: ["doc_1"], targetFolderId: null },
            },
          },
        },
      },
    },
  },
  ```

  Then enumerate the variants in the operation `description`.

- Keep response examples to the realistic success shape; the shared error blocks
  already illustrate error bodies.

---

## error responses

Keep using the shared `httpResponse*` blocks from
`utils/openapi/open-api-shared.ts` (`httpResponseUnauthorized`,
`httpResponseNotFound`, `httpResponseBadRequest`, `httpResponseConflict`,
`httpResponseRateLimit`, `httpResponseInternalServerError`, …). **List only the
errors the operation can actually return** — read the handler/service for the
real `throwHttpError(...)` call sites; don't blanket-attach every status, and
don't drop a 404/403 the code really throws. Per the security standard, missing
or unauthorized entities return **404**, not 403.

---

## Base spec & tags

- `open-api-base.ts` `info`: real `title`, multi-paragraph `description`
  (overview + auth model + base URL + per-environment tenancy), `contact`,
  `license`, and top-level `externalDocs` → README.
- `utils/openapi/tags.ts`: every entry in `openApiTagsSpec` carries a
  `description` (one line explaining the group). Reuse `OpenAPITags.*` names;
  don't invent tag strings in routes.

---

## Verification

Per feature and at the end:

```sh
deno fmt
deno lint
deno check main.ts
deno run --allow-read .agents/skills/deno-backend/scripts/verify_deps.ts
deno task check:openapi-docs   # the gate below
```

`scripts/check-openapi-docs.ts` renders the document and **fails** if any
operation lacks `summary`/`description`/`operationId`, if any `operationId`
collides, or if any used tag lacks a `description`. This prevents regression.

---

## Anti-patterns

- Descriptions copied from the path or guessed without reading the
  handler/service.
- `summary` longer than ~60 chars or missing a verb.
- `operationId` absent, unstable, or colliding.
- `security: []` on an endpoint that actually requires auth (or vice versa).
- Placeholder examples (`"string"`, `0`).
- Blanket-attaching every error status instead of the real ones.
- Editing `index.ts` wiring order or `main.ts` mounts — docs are metadata only.
- Editing shared barrels (`models/*/index.ts`), `tags.ts`, `open-api-base.ts`,
  or `open-api-shared.ts` from a feature task — those are centralized.
