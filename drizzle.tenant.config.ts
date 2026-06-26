import { defineConfig } from "drizzle-kit";

/**
 * @file drizzle.tenant.config.ts
 * @description drizzle-kit config for the per-tenant SQLite/libSQL schema. Used by the db:generate:tenant / db:migrate:tenant /
 *  db:push:tenant tasks. Tenant DBs are created per-environment at runtime; for generate (no connection needed) only schema + out matter.
 *  For migrate/push, point BOOTSTRAP_TENANT_DB_URL at the specific tenant DB you want to act on.
 */
export default defineConfig({
  dialect: "turso",
  schema: "./db/schema/tenant/index.ts",
  out: "./db/tenant-migrations",
  dbCredentials: {
    url: Deno.env.get("BOOTSTRAP_TENANT_DB_URL") ?? "file:./.data/db/tenant.db",
    authToken: Deno.env.get("BOOTSTRAP_TENANT_DB_TOKEN") ?? undefined,
  },
});
