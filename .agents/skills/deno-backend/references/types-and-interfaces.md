# Types & Interfaces

Types/interfaces **used across multiple services, handlers, or routes** go in
the `interfaces/` directory at the project root. This prevents circular
dependencies and is the single source of truth for cross-cutting types.

```
interfaces/
  ├── auth.ts            # Authentication types
  ├── cache.ts           # Cache provider & config types
  ├── context.ts         # Shared context types (no imports)
  ├── documents.ts       # Document operation types
  ├── error.ts           # Error enums & categories
  ├── session.ts         # Session management types
  ├── storage.ts         # Storage provider types
  ├── token.ts           # Token payload types
  ├── tracing.ts         # Distributed tracing types
  ├── user.ts            # User & environment types
  ├── validation.ts      # Validation schema types
  └── ...
```

## Placement rules

| Scope | Location | Example |
| ----- | -------- | ------- |
| Shared across services/handlers/routes | `interfaces/<domain>.ts` | `IUserLookupResult`, `CacheProvider`, `LogContext` |
| Scoped to a single service | Co-located in the service file | `type InternalHelperInput = { ... }` |
| API request/response schemas (Zod) | `models/<feature>/` | `SchemaFeatureRequest`, `IFeatureRequest` |
| Database row types | Inferred from Drizzle schema | `typeof table.$inferSelect` |

## Conventions

```typescript
// interfaces/feature.ts

/**
 * @file interfaces/feature.ts
 * @description Feature-related interfaces shared across services and handlers
 */

/** Prefix interfaces with 'I', types are fine without */
export interface IFeatureConfig {
  maxItems: number;
  enableAudit: boolean;
}

/** Enums belong here when shared across layers */
export enum FeatureStatus {
  ACTIVE = "active",
  ARCHIVED = "archived",
}

/** Generic/reusable types belong here */
export type FeaturePermissionLevel = "read" | "write" | "admin";
```

## Do NOT

- Put service-internal types in `interfaces/` — keep them co-located.
- Import from service files into `interfaces/` — interfaces may only import from
  `@constants`, `@config`, `@deps`, `@utils`, or other `@interfaces`.
- Duplicate types that already exist in Zod models — use `z.infer<typeof Schema>`.
- Use `any` in shared interfaces — prefer `unknown` with proper narrowing.
