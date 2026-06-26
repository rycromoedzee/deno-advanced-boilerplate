# Database Patterns

Drizzle ORM over libSQL/Turso. For tenant DB resolution, pooling, and isolation
see `references/multitenancy.md`.

## Basic operations

```typescript
// Query with where
const [item] = await db
  .select()
  .from(table)
  .where(eq(table.id, itemId))
  .limit(1);

// Insert with returning
const [created] = await db.insert(table).values({ ... }).returning();

// Upsert
await db.insert(table).values({ ... })
  .onConflictDoUpdate({
    target: [table.environmentId, table.notificationTypeId],
    set: { field: sql`now()` },
  });

// Transaction
await db.transaction(async (tx) => { /* ... */ });
```

## Critical checks (do not skip)

```typescript
// ALWAYS check isActive: true for user queries
.where(and(eq(users.id, userId), eq(users.isActive, true)))

// ALWAYS filter by environmentId for environment-scoped data
.where(and(eq(table.environmentId, environmentId), eq(table.isActive, true)))
```

> 🔒 Environment-scoped data MUST filter by `environmentId`. A query that
> touches tenant data without an `environmentId` scope is a tenant-isolation
> bug — stop and add the filter.

## Traced queries

```typescript
const [types] = await traced("ServiceName.getMethod", "db.query", async () => {
  return db.select().from(table).where(eq(table.isActive, true));
});
```

- Use `traced()` for ad-hoc DB calls.
- Service methods should wrap their whole body in `tracedWithServiceErrorHandling`
  (see `error-handling.md`) rather than hand-rolling try/catch around `traced()`.
- Never write string-concatenated SQL; Drizzle parameterizes — keep it that way.
- Access the DB via the project's accessors (`getTenantDB()` / `getGlobalDB()` /
  the `@db/index.ts` `getDB()` re-export), never by constructing a client
  inline.
