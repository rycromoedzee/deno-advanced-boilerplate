/**
 * @file services/tenant/provisioning.service.ts
 * @description Provisioning service (tenant)
 */
import { envConfig } from "@config/env.ts";
import { useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";
import { createNodeClient, createWebClient, drizzle, eq, type LibSQLClient, migrate } from "@deps";
import * as tenantSchema from "@db/schema/tenant/index.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";

const TENANT_MIGRATIONS_DIR = "./db/tenant-migrations";

function createLibSQLClient(config: { url: string; authToken?: string }): LibSQLClient {
  if (config.url.startsWith("file:")) {
    return createNodeClient(config);
  }
  return createWebClient(config);
}

export class TenantProvisioningService {
  /**
   * Called during environment/user registration.
   * Encrypts and stores credentials, then runs tenant migrations on the new DB.
   */
  async provisionTenantDB(environmentId: string, dbUrl: string, dbToken: string) {
    const globalDb = getGlobalDB();

    // 1. Derive encryption key
    const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
      envConfig.auth.generalEncryptionKey!,
      HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
    );

    // 2. Encrypt dbUrl and dbToken
    const dbUrlEncrypted = await useSymmetricEncrypt({
      key: encryptionKey,
      data: new TextEncoder().encode(dbUrl),
    });

    const dbTokenEncrypted = await useSymmetricEncrypt({
      key: encryptionKey,
      data: new TextEncoder().encode(dbToken),
    });

    // 3. Store encrypted credentials in environmentSqliteRegistry
    await globalDb.insert(globalTables.environmentSqliteRegistry).values({
      id: environmentId,
      dbUrlEncrypted,
      dbTokenEncrypted,
      isActive: true,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    });

    // 4. Connect to new DB and run tenant migrations
    const tenantClient = createLibSQLClient(
      dbUrl.startsWith("file:") ? { url: dbUrl } : { url: dbUrl, authToken: dbToken },
    );
    try {
      const tenantDb = drizzle(tenantClient, { schema: tenantSchema });
      await migrate(tenantDb, { migrationsFolder: TENANT_MIGRATIONS_DIR });
    } finally {
      tenantClient.close();
    }
  }

  async deprovisionTenantDB(environmentId: string) {
    const globalDb = getGlobalDB();

    // 1. Remove from environmentSqliteRegistry
    await globalDb.delete(globalTables.environmentSqliteRegistry)
      .where(eq(globalTables.environmentSqliteRegistry.id, environmentId));

    // 2. Evict from connection cache (will happen naturally via idle timeout or we can force it)
    // Actually, we don't have a direct "evict" export from db.ts yet, but we could add one.
  }

  async rotateCredentials(environmentId: string, newDbUrl: string, newDbToken: string) {
    const globalDb = getGlobalDB();

    const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
      envConfig.auth.generalEncryptionKey!,
      HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
    );

    const dbUrlEncrypted = await useSymmetricEncrypt({
      key: encryptionKey,
      data: new TextEncoder().encode(newDbUrl),
    });

    const dbTokenEncrypted = await useSymmetricEncrypt({
      key: encryptionKey,
      data: new TextEncoder().encode(newDbToken),
    });

    await globalDb.update(globalTables.environmentSqliteRegistry)
      .set({
        dbUrlEncrypted,
        dbTokenEncrypted,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(globalTables.environmentSqliteRegistry.id, environmentId));
  }
}

// Singleton getter now lives in ./singletons.ts (re-exported from index.ts).
