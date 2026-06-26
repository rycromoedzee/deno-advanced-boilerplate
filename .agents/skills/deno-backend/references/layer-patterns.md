# Layer Patterns

The layered architecture is non-negotiable:

```
Route (OpenAPI + Zod) → Handler (defineHandler) → Service (business logic) → Database (Drizzle ORM)
```

- **Routes** = API contracts (OpenAPI schemas, Zod validation, HTTP response definitions)
- **Handlers** = orchestration (extract context, call services, return response)
- **Services** = business logic (permission checks, DB operations, error handling)
- **Database** = Drizzle ORM with traced queries

---

## Service Layer Pattern

```typescript
// feature-create.service.ts
export class FeatureCreateService {
  async createFeature(
    userId: string,
    environmentId: string,
    isAdmin: boolean,
    input: FeatureInput,
  ): Promise<OutputType> {
    return await tracedWithServiceErrorHandling(
      "FeatureCreate.createFeature",
      {
        service: "FeatureCreate",
        method: "createFeature",
        section: loggerAppSections.RELEVANT_SECTION,
        details: { userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["key"] = value;

        // Permission check - isAdmin is passed from handler context
        if (!isAdmin) {
          throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
        }

        // DB operation
        const [result] = await db
          .insert(relevantSchemaTable)
          .values({ environmentId, field1: input.field1 })
          .returning();

        return result;
      },
    );
  }
}
```

### Singleton & Index

```typescript
// singletons.ts
let featureCreateService: FeatureCreateService;
export function getFeatureCreateService(): FeatureCreateService {
  if (!featureCreateService) featureCreateService = new FeatureCreateService();
  return featureCreateService;
}

// index.ts
export { FeatureCreateService } from "./feature-create.service.ts";
export { getFeatureCreateService } from "./singletons.ts";
export type { FeatureInput } from "./feature-create.service.ts";
```

---

## Handler Layer Pattern

```typescript
export const getFeatureHandler = defineHandler(
  {
    entityType: "feature",
    loggerSection: loggerAppSections.RELEVANT_SECTION,
    route: getFeatureRoute,
    operationName: "feature_list",
    responseSchema: SchemaFeatureListResponse,
  },
  async ({ userId, environmentId, isAdmin, body }) => {
    const result = await getFeatureService().listFeatures(environmentId, isAdmin);
    return { data: result, status: 200 };
  },
);
```

**Context available:** `userId`, `environmentId`, `isAdmin`, `params`, `body`,
`query`, `traceService`, `c`, `requestStartTime`.

---

## Response DTOs (output shaping)

Every JSON endpoint **must** include `responseSchema` in its `defineHandler`
config. Response schemas are Zod schemas co-located with request schemas in
`models/<feature>/`.

```
models/users/api-keys.ts → SchemaUserApiKeyCreateResponse (the DTO)
handlers/shared/handler.factory.ts → responseSchema.parse(result.data) strips extra fields
```

### How it works

1. The service returns its internal type (may include extra fields like internal IDs, hashes, flags).
2. The handler returns `{ data: serviceResult, status: NNN }`.
3. The factory calls `responseSchema.parse(result.data)` before sending.
4. Zod strips any field not defined in the schema — preventing accidental leaks.

### Rules

- **Every `defineHandler` JSON endpoint must include `responseSchema`** — the output contract.
- Response schemas live in `models/<feature>/`, never in handlers.
- Services return internal types; the factory enforces the contract via `responseSchema.parse()`.
- Manual response construction (`const response: IType = { ... }`) is an **anti-pattern** — let the schema shape it.
- Non-JSON endpoints (streams, downloads, HTML, SSE) are the **only** valid reason to skip `responseSchema`.
- For `204 No Content`, omit `responseSchema` — nothing to validate.

### Creating a new response schema

```typescript
// models/users/password.model.ts
import { z } from "@deps";

export const SchemaPasswordSetResponse = z.object({
  success: z.literal(true),
});

export type IPasswordSetResponse = z.infer<typeof SchemaPasswordSetResponse>;
```

Then re-export from the domain's `index.ts` and reference in the handler config.

---

## Route Layer Pattern

```typescript
// feature.route.ts
export const listFeaturesRoute = createRoute({
  method: "get",
  path: "/features",
  summary: "List all features",
  tags: [OpenAPITags.featureCategory],
  responses: {
    200: { content: { "application/json": { schema: SchemaFeatureListResponse } } },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
```

Schemas in `models/feature/index.ts`:

```typescript
export const SchemaFeatureRequest = z.object({
  field1: z.string().trim().max(255).openapi({ description: "...", example: "value" }),
});
export type IFeatureRequest = z.infer<typeof SchemaFeatureRequest>;
```
