#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-sys
/**
 * @file db/push-schemas.ts
 * @description Pushes drizzle schema definitions to the DB (schema sync)
 */
/**
 * Push schemas to global and tenant databases using Drizzle migrations.
 *
 * This is the PRIMARY migration script for the application.
 * It applies Drizzle-generated migrations to SQLite databases,
 * ensuring schema is always in sync with the Drizzle schema definitions.
 *
 * Usage:
 *   deno run -A db/push-schemas.ts [--all|--global|--tenant] [--dry-run]
 *
 * Options:
 *   --all        Push both global and tenant schemas (default)
 *   --global     Push only global schema
 *   --tenant     Push only tenant schema (to template database)
 *   --all-tenants Push to all tenant databases (iterates through environments)
 *   --dry-run    Simulate migrations without applying changes
 *
 * Examples:
 *   # Push both schemas (default)
 *   deno run -A db/push-schemas.ts
 *
 *   # Push only global schema
 *   deno run -A db/push-schemas.ts --global
 *
 *   # Push to all tenant databases
 *   deno run -A db/push-schemas.ts --all-tenants
 *
 * To generate new migrations after schema changes:
 *   deno run -A npm:drizzle-kit generate --config=drizzle.global.config.ts
 *   deno run -A npm:drizzle-kit generate --config=drizzle.tenant.config.ts
 */

import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { type Client as LibSQLClient, createClient as createWebClient } from "@libsql/client";
import { createClient as createNodeClient } from "@libsql/client/node";
import { envConfig } from "@config/env.ts";
import { getDecryptedTenantCredentials, getGlobalDB, globalTables, tenantDbPath } from "./db.ts";
import * as globalSchema from "./schema/global/index.ts";
import * as tenantSchema from "./schema/tenant/index.ts";

const GLOBAL_MIGRATIONS_DIR = "./db/global-migrations";
const TENANT_MIGRATIONS_DIR = "./db/tenant-migrations";

// Helper to create the right client based on URL scheme
function createClient(config: { url: string; authToken?: string }): LibSQLClient {
  if (config.url.startsWith("file:")) {
    return createNodeClient(config);
  }
  return createWebClient(config);
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

function isLocalDev(): boolean {
  return envConfig.isDevelopment || envConfig.env === "development";
}

async function pushGlobalSchema(dryRun: boolean = false): Promise<void> {
  console.log("📦 Pushing global schema via migrations...");

  if (envConfig.isDevelopment) {
    await ensureDirectory(".data/db");
  }

  const globalClient = envConfig.isDevelopment ? createClient({ url: "file:./.data/db/global.db" }) : createClient({
    url: envConfig.database.globalSqliteUrl!,
    authToken: envConfig.database.globalSqliteToken!,
  });

  try {
    const db = drizzle(globalClient, { schema: globalSchema });
    if (!dryRun) {
      await migrate(db, { migrationsFolder: GLOBAL_MIGRATIONS_DIR });
      console.log("✅ Global schema pushed successfully");
    } else {
      console.log("🔍 DRY RUN - Would push global schema");
    }
  } finally {
    globalClient.close();
  }
}

async function pushTenantSchemaToUrl(
  tenantDbUrl: string,
  authToken?: string,
  dryRun: boolean = false,
): Promise<void> {
  console.log("📦 Pushing tenant schema via migrations...");

  if (tenantDbUrl.startsWith("file:")) {
    await ensureDirectory(".data/db");
  }

  const tenantClient = createClient({ url: tenantDbUrl, authToken });

  try {
    const db = drizzle(tenantClient, { schema: tenantSchema });
    if (!dryRun) {
      await migrate(db, { migrationsFolder: TENANT_MIGRATIONS_DIR });
      console.log("✅ Tenant schema pushed successfully");
    } else {
      console.log("🔍 DRY RUN - Would push tenant schema");
    }
  } finally {
    tenantClient.close();
  }
}

async function pushTenantSchema(dryRun: boolean = false): Promise<void> {
  await pushTenantSchemaToUrl(
    dryRun ? "file:./.data/db/tenant_template.db" : "file:./.data/db/tenant_template.db",
    undefined,
    dryRun,
  );
}

async function pushAllTenants(dryRun: boolean = false): Promise<void> {
  console.log(`🚀 Pushing migrations to ALL tenant databases${dryRun ? " (DRY RUN)" : ""}...`);

  const globalDb = getGlobalDB();
  const environments = await globalDb.select().from(globalTables.environments);

  let successCount = 0;
  let failedCount = 0;
  const skippedCount = 0;

  console.log(`Found ${environments.length} environment(s)`);

  for (const env of environments) {
    const envLabel = `${env.name} (${env.id})`;

    let tenantClient: LibSQLClient | null = null;

    try {
      if (isLocalDev()) {
        tenantClient = createClient({
          url: tenantDbPath(env.id),
        });
      } else {
        const creds = await getDecryptedTenantCredentials(env.id);
        tenantClient = createClient({ url: creds.url, authToken: creds.token });
      }

      const tenantDb = drizzle(tenantClient, { schema: tenantSchema });

      if (!dryRun) {
        await migrate(tenantDb, { migrationsFolder: TENANT_MIGRATIONS_DIR });
        console.log(`✅ Migrated: ${envLabel}`);
      } else {
        console.log(`🔍 Would migrate: ${envLabel}`);
      }

      successCount++;
    } catch (error) {
      failedCount++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to migrate ${envLabel}: ${errorMsg}`);
    } finally {
      if (tenantClient) tenantClient.close();
    }
  }

  console.log("\n📊 Migration Summary:");
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failedCount}`);
  console.log(`   ⏭️ Skipped: ${skippedCount}`);
}

async function main(): Promise<void> {
  const args = Deno.args;
  const dryRun = args.includes("--dry-run");
  const migrateAll = args.includes("--all-tenants");
  const pushGlobalOnly = args.includes("--global");
  const pushTenantOnly = args.includes("--tenant");

  // Default to pushing both if no specific flag is provided
  const pushGlobal = pushGlobalOnly || (!pushTenantOnly && !migrateAll);
  const pushTenant = pushTenantOnly || (!pushGlobalOnly && !migrateAll);

  console.log("🚀 Starting schema push...\n");

  if (migrateAll) {
    await pushAllTenants(dryRun);
  } else {
    if (pushGlobal) {
      await pushGlobalSchema(dryRun);
    }

    if (pushTenant) {
      await pushTenantSchema(dryRun);
    }
  }

  console.log("\n🎉 Schema push complete!");
}

// Only run main if this is the main module (not imported)
if (import.meta.main) {
  main().catch((error) => {
    console.error("💥 Schema push failed:", error);
    Deno.exit(1);
  });
}
