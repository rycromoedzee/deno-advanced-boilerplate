#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-ffi --allow-sys --allow-run
/**
 * Bootstrap script — runs from start.sh before deno serve.
 *
 * 1. Always runs global DB migrations (idempotent).
 * 2. If RUN_BOOTSTRAP=true and zero environments exist, performs first-install:
 *    - Creates default environment
 *    - Provisions tenant DB
 *    - Runs tenant migrations
 *    - Seeds tenant defaults (permissions, notification types)
 *    - Creates first super-admin user
 *    - Activates environment
 *
 * IMPORTANT: The .data/db directory MUST exist before any imports that might
 * transitively call getGlobalDB(). The directory is ensured at the very top
 * of this file, before any imports.
 */

// ─── Step 0: Ensure local DB directory exists ───────────────────────
// This MUST be the very first thing that runs, before any imports.
// In local dev, the .data/db directory must exist before LibSQL can open
// file-based databases. In production, DB URL/token come from .env.
// Note: Deno.env.get() works without imports in Deno's runtime environment.
const isDevelopment = Deno.env.get("NODE_ENV") === "development" ||
  Deno.env.get("NODE_ENV") !== "production"; // default to development if not set

if (isDevelopment) {
  const dbDirectory = "./.data/db";
  try {
    Deno.mkdirSync(dbDirectory, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
}

// ─── Now safe to import modules that touch the DB ───────────────────

import { eq } from "@deps";
import { envConfig } from "@config/env.ts";
import { getGlobalDB, globalTables, tenantDbPath } from "@db/index.ts";
import { runSeeders } from "../../db/seed/index.ts";
import { generateIdForEnvironment, generateIdForUser } from "@utils/database/id-generation/index.ts";
import { useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";
import { AuthPasswordService } from "@services/auth/password-auth.service.ts";
import { UserMasterKeySetupService } from "@services/auth/user-master-key-setup.service.ts";

import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { type Client as LibSQLClient, createClient as createWebClient } from "@libsql/client";
import { createClient as createNodeClient } from "@libsql/client/node";
import * as tenantSchema from "../../db/schema/tenant/index.ts";

const GLOBAL_MIGRATIONS_DIR = "./db/global-migrations";
const TENANT_MIGRATIONS_DIR = "./db/tenant-migrations";

function createClient(config: { url: string; authToken?: string }): LibSQLClient {
  if (config.url.startsWith("file:")) {
    return createNodeClient(config);
  }
  return createWebClient(config);
}

function isLocalDev(): boolean {
  return envConfig.isDevelopment || envConfig.env === "development";
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function generateSecurePassword(length: number = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  const array = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}

// ─── Step 1: Global migrations ──────────────────────────────────────

async function runGlobalMigrations(): Promise<void> {
  console.log("Running global DB migrations...");

  const globalDb = getGlobalDB();
  await migrate(globalDb, { migrationsFolder: GLOBAL_MIGRATIONS_DIR });

  console.log("Global migrations complete");
}

// ─── Step 2: Fresh-install detection ────────────────────────────────

async function getEnvironmentSummary(): Promise<{ total: number; hasProvisioning: boolean }> {
  const globalDb = getGlobalDB();
  const rows = await globalDb
    .select({ id: globalTables.environments.id, status: globalTables.environments.status })
    .from(globalTables.environments);
  return {
    total: rows.length,
    hasProvisioning: rows.some((r) => r.status === "provisioning"),
  };
}

// ─── Step 3: Create environment ─────────────────────────────────────

async function createEnvironment(): Promise<string> {
  const globalDb = getGlobalDB();
  const environmentId = generateIdForEnvironment();
  const now = nowSeconds();

  await globalDb.insert(globalTables.environments).values({
    id: environmentId,
    name: envConfig.bootstrap.envName,
    description: envConfig.bootstrap.envDescription,
    status: "provisioning",
    createdAt: now,
    updatedAt: now,
  });

  console.log(`Created environment: ${envConfig.bootstrap.envName} (${environmentId})`);
  return environmentId;
}

// ─── Step 4: Provision tenant DB ────────────────────────────────────

async function provisionTenantDb(environmentId: string): Promise<{ url: string; token: string }> {
  let dbUrl: string;
  let dbToken: string;

  if (envConfig.bootstrap.tenantDbUrl) {
    // Production: use provided URL/token
    dbUrl = envConfig.bootstrap.tenantDbUrl;
    dbToken = envConfig.bootstrap.tenantDbToken;
  } else if (isLocalDev()) {
    // Local dev: auto-create file DB
    const dbDirectory = "./.data/db";
    try {
      await Deno.mkdir(dbDirectory, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }

    dbUrl = tenantDbPath(environmentId);
    dbToken = "";

    // Create the database file by opening a connection
    const tempClient = createClient({ url: dbUrl });
    try {
      const tempDb = drizzle(tempClient);
      await tempDb.$client.execute("SELECT 1");
    } finally {
      tempClient.close();
    }
  } else {
    // Production without URL: attempt auto-create (not yet implemented)
    throw new Error(
      "Remote tenant DB auto-provisioning not yet implemented. " +
        "Set BOOTSTRAP_TENANT_DB_URL and BOOTSTRAP_TENANT_DB_TOKEN.",
    );
  }

  // Register in environment_sqlite_registry with encrypted credentials
  const globalDb = getGlobalDB();
  const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
    envConfig.auth.generalEncryptionKey!,
    HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
  );

  const dbUrlEncrypted = await useSymmetricEncrypt({
    key: encryptionKey,
    data: new TextEncoder().encode(dbUrl),
  });

  const dbTokenEncrypted = dbToken.length > 0
    ? await useSymmetricEncrypt({
      key: encryptionKey,
      data: new TextEncoder().encode(dbToken),
    })
    : null;

  const now = nowSeconds();
  await globalDb.insert(globalTables.environmentSqliteRegistry).values({
    id: environmentId,
    dbUrlEncrypted,
    dbTokenEncrypted,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  console.log(`Tenant DB registered: ${dbUrl.startsWith("file:") ? dbUrl : "(remote)"}`);
  return { url: dbUrl, token: dbToken };
}

// ─── Step 5: Run tenant migrations ──────────────────────────────────

async function runTenantMigrations(dbUrl: string, dbToken: string): Promise<void> {
  console.log("Running tenant DB migrations...");

  const tenantClient = createClient(
    dbUrl.startsWith("file:") ? { url: dbUrl } : { url: dbUrl, authToken: dbToken },
  );

  try {
    const tenantDb = drizzle(tenantClient, { schema: tenantSchema });
    await migrate(tenantDb, { migrationsFolder: TENANT_MIGRATIONS_DIR });
  } finally {
    tenantClient.close();
  }

  console.log("Tenant migrations complete");
}

// ─── Step 6: Seed tenant defaults ───────────────────────────────────

async function seedTenantDefaults(dbUrl: string, dbToken: string): Promise<void> {
  console.log("Seeding tenant defaults...");

  const tenantClient = createClient(
    dbUrl.startsWith("file:") ? { url: dbUrl } : { url: dbUrl, authToken: dbToken },
  );

  try {
    const tenantDb = drizzle(tenantClient, { schema: tenantSchema });
    await runSeeders(tenantDb);
  } finally {
    tenantClient.close();
  }
}

// ─── Step 7: Create first admin user ────────────────────────────────

async function createFirstAdmin(environmentId: string, dbUrl: string, dbToken: string): Promise<void> {
  const globalDb = getGlobalDB();

  // Determine admin credentials
  const publicUrl = envConfig.baseDomain || "app.localhost";
  const adminEmail = envConfig.bootstrap.adminEmail || `admin@${publicUrl}`;
  const adminPassword = envConfig.bootstrap.adminPassword || generateSecurePassword();
  const adminFirstName = envConfig.bootstrap.adminFirstName;
  const adminLastName = envConfig.bootstrap.adminLastName;

  // Hash password using existing auth service (Argon2id)
  const passwordHash = await AuthPasswordService.generatePassword(adminPassword, true);

  // Create user in global DB
  const adminUserId = generateIdForUser();
  const now = nowSeconds();

  await globalDb.insert(globalTables.users).values({
    id: adminUserId,
    email: adminEmail.toLowerCase().trim(),
    password: passwordHash,
    username: adminEmail.toLowerCase().trim(),
    firstName: adminFirstName,
    lastName: adminLastName,
    environmentId: environmentId,
    isActive: true,
    isSuperAdmin: true,
    createdAt: now,
    updatedAt: now,
  });

  // Create user profile in tenant DB
  const tenantClient = createClient(
    dbUrl.startsWith("file:") ? { url: dbUrl } : { url: dbUrl, authToken: dbToken },
  );

  try {
    const tenantDb = drizzle(tenantClient, { schema: tenantSchema });

    await tenantDb.insert(tenantSchema.userProfiles).values({
      userId: adminUserId,
      email: adminEmail.toLowerCase().trim(),
      firstName: adminFirstName,
      lastName: adminLastName,
      isAdmin: true,
      createdAt: now,
      updatedAt: now,
    });

    // Initialize userEncryption record
    await tenantDb.insert(tenantSchema.userEncryption).values({
      userId: adminUserId,
      createdAt: now,
      updatedAt: now,
    });

    // Assign Admin permission group
    const [adminGroup] = await tenantDb
      .select({ id: tenantSchema.permissionGroups.id })
      .from(tenantSchema.permissionGroups)
      .where(eq(tenantSchema.permissionGroups.name, "Admin"))
      .limit(1);

    if (adminGroup) {
      await tenantDb
        .insert(tenantSchema.userPermissionGroups)
        .values({ userId: adminUserId, groupId: adminGroup.id })
        .onConflictDoNothing();
    }
  } finally {
    tenantClient.close();
  }

  // Setup master key encryption for the admin user
  const masterKeyService = new UserMasterKeySetupService();
  await masterKeyService.setupForPasswordRegistration(adminUserId, adminPassword);

  // Output credentials
  console.log("");
  console.log("==========================================================");
  console.log("  BOOTSTRAP COMPLETE — FIRST ADMIN CREDENTIALS");
  console.log("==========================================================");
  console.log(`  Email:    ${adminEmail}`);
  console.log(`  Password: ${adminPassword}`);
  console.log("");
  console.log("  Save these credentials securely.");
  console.log("  Change the password after first login.");
  console.log("==========================================================");
  console.log("");
}

// ─── Step 8: Activate environment ───────────────────────────────────

async function activateEnvironment(environmentId: string): Promise<void> {
  const globalDb = getGlobalDB();
  const now = nowSeconds();

  await globalDb
    .update(globalTables.environments)
    .set({ status: "active", updatedAt: now })
    .where(eq(globalTables.environments.id, environmentId));

  await globalDb
    .insert(globalTables.environmentQuotas)
    .values({
      id: environmentId,
      maxUsers: null,
      maxStorageKb: null,
      maxFileSizeKb: null,
      currentStorageKb: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  console.log("Environment activated");
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    // Always run global migrations
    await runGlobalMigrations();

    // Check if bootstrap is requested
    if (!envConfig.bootstrap.runBootstrap) {
      console.log("RUN_BOOTSTRAP not set — skipping bootstrap");
      return;
    }

    // Check if already initialized
    const { total: envCount, hasProvisioning } = await getEnvironmentSummary();
    if (envCount > 0) {
      if (hasProvisioning) {
        console.warn(
          "WARNING: An environment in 'provisioning' state was found. " +
            "A previous bootstrap may have failed. " +
            "Delete the stale environment record and re-run to bootstrap again.",
        );
      }
      console.log(`Already initialized (${envCount} environment(s) found) — skipping bootstrap`);
      return;
    }

    console.log("Fresh install detected — running bootstrap...");

    // Step 3: Create environment
    const environmentId = await createEnvironment();

    // Step 4: Provision tenant DB
    const { url: dbUrl, token: dbToken } = await provisionTenantDb(environmentId);

    // Step 5: Tenant migrations
    await runTenantMigrations(dbUrl, dbToken);

    // Step 6: Seed tenant defaults
    await seedTenantDefaults(dbUrl, dbToken);

    // Step 7: Create first admin
    await createFirstAdmin(environmentId, dbUrl, dbToken);

    // Step 8: Activate environment
    await activateEnvironment(environmentId);

    console.log("Bootstrap complete");
  } catch (error) {
    console.error("Bootstrap failed:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
  Deno.exit(0);
}
