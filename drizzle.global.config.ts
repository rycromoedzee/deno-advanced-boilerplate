import { defineConfig } from "drizzle-kit";

/**
 * @file drizzle.global.config.ts
 * @description drizzle-kit config for the global (cross-tenant) SQLite/libSQL schema. Used by the db:generate:global / db:migrate:global /
 *  db:push:global tasks. The runtime client is libsql (see db/db.ts); drizzle-kit's "turso" dialect is its libsql driver and accepts both
 *  local file: URLs (dev) and remote libSQL URLs (prod).
 */
export default defineConfig({
  dialect: "turso",
  schema: "./db/schema/global/index.ts",
  out: "./db/global-migrations",
  dbCredentials: {
    url: Deno.env.get("GLOBAL_SQLITE_URL") ?? "file:./.data/db/global.db",
    authToken: Deno.env.get("GLOBAL_SQLITE_TOKEN") ?? undefined,
  },
});
