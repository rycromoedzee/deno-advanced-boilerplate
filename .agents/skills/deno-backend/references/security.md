# Security

Secure-by-default is principle #3. For Deno permission flags, tenant DB-path
safety, and cache-key isolation, see `references/permissions.md` and
`references/multitenancy.md`.

## Input validation & sanitization

**All external input must be validated at the route layer** via Zod schemas
before reaching handlers or services.

```typescript
request: {
  body: { content: { "application/json": { schema: SchemaFeatureRequest } } },
  params: SchemaFeatureParams,
  query: SchemaFeatureQuery,
},
```

Rules:

- Never trust client-provided IDs without verifying ownership/access in the service layer.
- Sanitize string inputs that will be rendered (names, descriptions) — strip HTML/script tags.
- Validate file uploads against allowed MIME types and size limits via `IValidationFileRestrictions`.
- Use `z.string().trim()` to prevent whitespace-based bypasses.
- Use `z.string().max()` to enforce length limits aligned with DB column constraints.

## Permission checks

**Always in the service layer, not handlers.**

```typescript
// Admin check - isAdmin boolean passed from handler context (via getUserContext/defineHandler)
if (!isAdmin) throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");

// Specific permission check (works for userId or apiKey)
const canDelete = await hasPermission(userId, "documents.delete");
if (!canDelete) throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");

// For API keys, specify entityType explicitly
const canRead = await hasPermission(apiKeyId, "documents.read", { entityType: "apiKey" });
```

> **Note:** Active-user checks are not needed in services — the auth middleware
> validates tokens and confirms users are still active before requests reach
> handlers.

## Timing protection

Built into `defineHandler` — runs in the catch block (on errors) via
`ensureMinimumProcessingTime` to prevent timing attacks.

```typescript
import { TIMING_PROFILES } from "@utils/shared/timing.ts";

export const getFeatureHandler = defineHandler(
  {
    entityType: "feature",
    timingProfile: TIMING_PROFILES.FAST,
  },
  async (ctx) => {/* ... */},
);
```

Available profiles: `DOCUMENT_METADATA`, `DOCUMENT_FILE_INIT`, `AUTH_OPERATION`,
`SESSION_VALIDATION`, `COMPLEX_OPERATION`, `JWT_OPERATION`, `MAGIC_LINK_AUTH`,
`MULTI_USER_VALIDATION`, `WEBHOOK_TOKEN_VALIDATION`, `TWO_FACTOR_VALIDATION`,
`PASSWORD_OPERATION`.

## Security standards

### General
- **No secrets in code** — all via environment variables (`@config/env.ts`).
- **No sensitive data in logs** — tracing sanitizes attributes; never log passwords, tokens, or keys.
- **No sensitive data in error messages** — predefined keys; custom messages must not leak internals.
- **CORS, CSP, security headers** — configured in `security.ts`.

### Authentication & authorization
- JWT tokens must include `iat`, `exp`, `iss`, `aud`, `nbf` claims.
- Refresh tokens are single-use with rotation.
- API keys are hashed before storage — never store plaintext.
- Progressive delay on failed auth attempts to deter brute force.

### Data protection
- Encrypt sensitive data at rest using the encryption service.
- Use parameterized queries (Drizzle handles this) — never concatenate user input into SQL.
- Environment-scoped data must always filter by `environmentId`.
