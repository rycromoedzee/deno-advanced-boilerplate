# Error Handling

Every error response from the API **must** include a `messageKey` field for
frontend i18n/error handling. Three error sources:

1. **Zod OpenAPI schema validation** — input rejected by route schema (handled by `zodValidationHook`).
2. **Domain errors** — via `throwHttpError()` / `throwHttpErrorWithCustomMessage()`.
3. **Route-level OpenAPI response schemas** — must use `ErrorSchema` or shared `httpResponse*` helpers.

## Error response shape

```json
{
  "message": "Human-readable error message",
  "messageKey": "domain.specific-error-code"
}
```

## Choosing the helper

| Function | When to use |
| -------- | ----------- |
| `throwHttpError(errorKey)` | Standard predefined message |
| `throwHttpErrorWithCustomMessage(errorKey, "custom message")` | User-facing custom message (must not leak internals) |

```typescript
// Standard error
if (!admin) throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");

// Custom message (shown to user!)
if (!item) {
  throwHttpErrorWithCustomMessage("COMMON.NOT_FOUND", `Item not found: ${itemId}`);
}
```

Error keys come from `@constants/errors/index.ts`, organized by category:
`AUTH.`, `COMMON.`, `VALIDATION.`, `SESSION.`, `USER.`, `DOCUMENT.`, etc.

## Helper / internal utility functions

Helper classes (e.g. `DataEncryptionHelperService`, `EncryptionValidationHelper`)
are internal utilities called by service boundaries — they must **never** call
`useLogger` themselves. They should only:

1. Re-throw `AppHttpException` instances as-is.
2. Wrap unexpected errors with `throwHttpError(errorKey, cause)` and let it bubble.

The **calling service** owns structured logging. This prevents duplicate log
entries when a helper error propagates through multiple catch blocks.

> **Exception:** Errors fired inside a `ReadableStream` `pull()` callback —
> after the stream was already returned — have no outer catch boundary and
> **must** log inline before `controller.error()`. These are the only valid
> `useLogger` calls inside a helper.

```typescript
// ✅ Correct — helper just throws, no logging
static async encryptData(key: Uint8Array, data: Uint8Array) {
  try {
    // ...
  } catch (error) {
    if (error instanceof AppHttpException) throw error;
    throwHttpError("ENCRYPTION.ENCRYPTION_FAILED", error); // caller logs
  }
}

// ❌ Wrong — helper logs AND the caller logs = duplicate entries
static async encryptData(key: Uint8Array, data: Uint8Array) {
  try {
    // ...
  } catch (error) {
    if (error instanceof AppHttpException) throw error;
    useLogger(LoggerLevels.error, { message: "..." }); // ← remove this
    throwHttpError("ENCRYPTION.ENCRYPTION_FAILED", error);
  }
}
```

## Service boundaries: `_serviceErrorLogged`

Service boundaries that call helpers must use the `_serviceErrorLogged` flag to
avoid re-logging a 5xx `AppHttpException` already logged by an inner boundary:

```typescript
// ✅ Correct — service logs 5xx once, then re-throws
} catch (error) {
  if (error instanceof AppHttpException) {
    if (error.status >= 500 && !error._serviceErrorLogged) {
      useLogger(LoggerLevels.error, { message: "...", ... });
      error._serviceErrorLogged = true;
    }
    throw error;
  }
  useLogger(LoggerLevels.error, { message: "...", ... });
  throwHttpError("SOME.FALLBACK_ERROR", error);
}
```

Services using `tracedWithServiceErrorHandling` get this deduplication
automatically — **prefer that pattern** over hand-rolled catch blocks. Plain
(non-`traced`) service methods are NOT exempt; they must also use the wrapper.

- Recovered/continued failures log at `warn` (not `error`).
- Truly silent `catch (_error)` either logs at `warn` or is documented as an
  intentional "not found"/best-effort swallow.

## Zod validation errors (route layer)

Use `withKey()` to embed a `messageKey` in Zod messages, pipe-delimited
`messageKey|Human-readable message`:

```typescript
import { withKey } from "@utils/validation/zod-message-key.ts";

// Before:
z.string().min(1, "Password is required");

// After:
z.string().min(1, withKey("encryption.password-required", "Password is required"));
// Produces: "encryption.password-required|Password is required"
```

The `zodValidationHook` (configured as `defaultHook` on all `OpenAPIHono`
instances) parses the key via `parseMessageKey()` and throws an
`AppHttpException` with the proper `messageKey`.

> **Critical:** Every `new OpenAPIHono()` instance (including sub-apps in
> `main.ts`) must receive `{ defaultHook: zodValidationHook }` — sub-apps do
> **not** inherit the parent's `defaultHook` when mounted via `.route()`.

## Route error response schemas

Use the shared `ErrorSchema` (from `utils/openapi/open-api-shared.ts`) or the
`httpResponse*` helpers. Don't define inline error schemas lacking `messageKey`.

```typescript
responses: {
  ...httpResponseBadRequest,        // 400
  ...httpResponseUnauthorized,      // 401
  ...httpResponseInternalServerError, // 500
  409: {
    content: { "application/json": { schema: ErrorSchema } },
    description: "Conflict - reason",
  },
}
```

## 404 handling for entity access

When an entity is not found, doesn't exist, belongs to another environment, or
the user lacks access → **always throw 404** (not 403). Prevents information
disclosure.

```typescript
if (!item || item.environmentId !== environmentId) {
  throwHttpError("COMMON.NOT_FOUND"); // Don't expose why
}
```
