/**
 * Characterization test for the item-#2 design smell:
 *
 *   `DataAccessService.checkPermission` — a read-named authorization check —
 *   performs a WRITE (converts an ASYMMETRIC data key to USER_CONTROLLED via
 *   `ensureUserControlledDataKey` → `convertSharedToUserControlled`) whenever the
 *   caller passes a `userMasterKey`.
 *
 * These tests pin the CURRENT behavior so any refactor that splits the concern
 * can be verified behavior-preserving. They run against an isolated, file-backed
 * libSQL tenant DB created per test run.
 *
 * NOTE: this test must run with NODE_ENV=development so `db/db.ts` uses the local
 * `file:` SQLite path (isLocalDev()) and runs tenant migrations on connect. Under
 * NODE_ENV=test the DB layer takes the Turso credential path and there is no local
 * DB. Run via:
 *   NODE_ENV=development TRACING_ENABLED=false deno test --allow-all \
 *     tests/integration/services/encryption/data-access.checkpermission.test.ts
 */
import { assert, assertEquals } from "@std/assert";
import { bytesToHex, nodeRandomBytes } from "@deps";
import { and, eq } from "@deps";

import { requestContext } from "@db/context.ts";
import { evictTenantDB, getTenantDB, tenantDbPath, tenantTables } from "@db/index.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { DataAccessService } from "@services/encryption/data-access.service.ts";
import { PermissionService } from "@services/encryption/permission.service.ts";
import { encryptPrivateKey, encryptWithECIES, generateECIESKeyPair } from "@services/encryption/key-sharing.service.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";

// A fresh, filesystem-safe environmentId (NanoID alphabet, 8-32 chars). Unique
// per run so the isolated tenant DB doesn't collide with a prior run.
function freshEnvironmentId(): string {
  return "T" + bytesToHex(nodeRandomBytes(12)).slice(0, 24);
}

function freshKey32(): Uint8Array {
  return new Uint8Array(nodeRandomBytes(32));
}

const service = new DataAccessService({
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
});

// No cache adapter: every check hits the DB, so behavior is deterministic here.
const permissionService = new PermissionService({
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
});

interface SeedOptions {
  environmentId: string;
  userId: string;
  documentId: string;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  encryptionMode: DB_ENUM_ENCRYPTION_MODE;
  /** Required for ASYMMETRIC rows so the conversion has real, decryptable input. */
  userMasterKey?: Uint8Array;
}

/**
 * Seeds the minimal parent chain + the documents_data_keys row the
 * checkPermission / conversion path reads:
 *   storage_metadata -> documents -> user_profiles -> user_encryption
 *   -> documents_data_keys
 *
 * For ASYMMETRIC rows: generates an ECIES keypair for the user, ECIES-encrypts a
 * fresh data master key into `encrypted_master_key`, and stores the user's
 * private key encrypted under `userMasterKey` in user_encryption — exactly the
 * shape `convertSharedToUserControlled` expects.
 */
async function seed(opts: SeedOptions): Promise<{ dataMasterKey: Uint8Array | null }> {
  const db = await getTenantDB(opts.environmentId);
  const now = getTimeNowForStorage();

  const storageId = generateIdRandom();
  await db.insert(tenantTables.storageMetadata).values({
    id: storageId,
    originalName: "f.bin",
    mimeType: "application/octet-stream",
    folderPath: "f/" + storageId,
    userId: opts.userId,
  });

  await db.insert(tenantTables.documents).values({
    id: opts.documentId,
    name: "doc",
    storageMetadataId: storageId,
    ownerId: opts.userId,
  });

  await db.insert(tenantTables.userProfiles).values({
    userId: opts.userId,
  });

  let encryptedMasterKey: Uint8Array;
  let dataMasterKey: Uint8Array | null = null;

  if (opts.encryptionMode === DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC) {
    if (!opts.userMasterKey) throw new Error("ASYMMETRIC seed requires userMasterKey");
    const keyPair = generateECIESKeyPair();
    dataMasterKey = freshKey32();
    encryptedMasterKey = await encryptWithECIES(dataMasterKey, keyPair.publicKey);

    const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, opts.userMasterKey);

    await db.insert(tenantTables.userEncryption).values({
      userId: opts.userId,
      isEnhancedEncryptionEnabled: true,
      publicKey: keyPair.publicKey,
      encryptedPrivateKey,
    });
  } else {
    // Non-ASYMMETRIC rows are never converted; the bytes themselves are opaque
    // to checkPermission, so any non-empty blob is sufficient.
    encryptedMasterKey = freshKey32();
    await db.insert(tenantTables.userEncryption).values({
      userId: opts.userId,
      isEnhancedEncryptionEnabled: true,
    });
  }

  await db.insert(tenantTables.documentsDataKeys).values({
    id: generateIdRandom(),
    documentId: opts.documentId,
    userId: opts.userId,
    encryptedMasterKey,
    encryptionMode: opts.encryptionMode,
    permissionLevel: opts.permissionLevel,
    isActive: true,
    keyVersion: 1,
    grantedAt: now,
    grantedBy: opts.userId,
    accessCount: 0,
  });

  return { dataMasterKey };
}

async function readDataKeyRow(environmentId: string, documentId: string, userId: string) {
  const db = await getTenantDB(environmentId);
  const [row] = await db
    .select({
      encryptedMasterKey: tenantTables.documentsDataKeys.encryptedMasterKey,
      encryptionMode: tenantTables.documentsDataKeys.encryptionMode,
    })
    .from(tenantTables.documentsDataKeys)
    .where(
      and(
        eq(tenantTables.documentsDataKeys.documentId, documentId),
        eq(tenantTables.documentsDataKeys.userId, userId),
        eq(tenantTables.documentsDataKeys.isActive, true),
      ),
    )
    .limit(1);
  return row;
}

/** Runs `fn` inside a request context bound to the test tenant, with cleanup. */
async function withTenant<T>(environmentId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await requestContext.run(
      { environmentId, userId },
      fn,
    );
  } finally {
    evictTenantDB(environmentId);
    try {
      await Deno.remove(new URL(tenantDbPath(environmentId).replace("file:", "file://")).pathname);
    } catch { /* best effort */ }
  }
}

Deno.test(
  "checkPermission is a PURE read: it does NOT mutate an ASYMMETRIC row (post-#2 split)",
  async () => {
    const environmentId = freshEnvironmentId();
    const userId = "user_" + bytesToHex(nodeRandomBytes(6));
    const documentId = "doc_" + bytesToHex(nodeRandomBytes(6));
    const userMasterKey = freshKey32();

    await withTenant(environmentId, userId, async () => {
      await seed({
        environmentId,
        userId,
        documentId,
        permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
        encryptionMode: DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
        userMasterKey,
      });

      const before = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(before.encryptionMode, DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC);
      const beforeBytes = before.encryptedMasterKey as Uint8Array;

      const result = await service.checkPermission(
        documentId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
      );

      // Permission decision is correct...
      assertEquals(result.hasPermission, true);
      assertEquals(result.currentLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD);

      // ...and the row is UNCHANGED: no hidden conversion side effect.
      const after = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(
        after.encryptionMode,
        DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
        "checkPermission must not persist a key-type conversion",
      );
      assertEquals(
        bytesToHex(after.encryptedMasterKey as Uint8Array),
        bytesToHex(beforeBytes),
        "checkPermission must not rewrite encrypted_master_key",
      );
    });
  },
);

Deno.test(
  "ensureUserControlledDataKey explicitly CONVERTS an ASYMMETRIC row to USER_CONTROLLED",
  async () => {
    const environmentId = freshEnvironmentId();
    const userId = "user_" + bytesToHex(nodeRandomBytes(6));
    const documentId = "doc_" + bytesToHex(nodeRandomBytes(6));
    const userMasterKey = freshKey32();

    await withTenant(environmentId, userId, async () => {
      await seed({
        environmentId,
        userId,
        documentId,
        permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
        encryptionMode: DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
        userMasterKey,
      });

      const before = await readDataKeyRow(environmentId, documentId, userId);
      const beforeBytes = before.encryptedMasterKey as Uint8Array;

      // The conversion is now an explicit, separately-named step the caller
      // opts into (this is what the download/stream/preview paths invoke after
      // a successful checkPermission).
      const converted = await service.ensureUserControlledDataKey(documentId, userId, userMasterKey);
      assertEquals(converted?.encryptionMode, DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED);

      const after = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(after.encryptionMode, DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED);
      assert(
        bytesToHex(after.encryptedMasterKey as Uint8Array) !== bytesToHex(beforeBytes),
        "encrypted_master_key should be re-encrypted (symmetric, user-controlled)",
      );

      // Idempotent: a second call is a no-op (already USER_CONTROLLED).
      const second = await service.ensureUserControlledDataKey(documentId, userId, userMasterKey);
      assertEquals(second?.encryptionMode, DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED);
      const afterSecond = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(
        bytesToHex(afterSecond.encryptedMasterKey as Uint8Array),
        bytesToHex(after.encryptedMasterKey as Uint8Array),
        "second conversion attempt must not rewrite the already-converted row",
      );
    });
  },
);

Deno.test(
  "ensureUserControlledDataKey leaves a non-ASYMMETRIC (APP_CONTROLLED) row unchanged",
  async () => {
    const environmentId = freshEnvironmentId();
    const userId = "user_" + bytesToHex(nodeRandomBytes(6));
    const documentId = "doc_" + bytesToHex(nodeRandomBytes(6));
    const userMasterKey = freshKey32();

    await withTenant(environmentId, userId, async () => {
      await seed({
        environmentId,
        userId,
        documentId,
        permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
        encryptionMode: DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
      });

      const before = await readDataKeyRow(environmentId, documentId, userId);

      const result = await service.ensureUserControlledDataKey(documentId, userId, userMasterKey);
      assertEquals(result?.encryptionMode, DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED);

      const after = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(after.encryptionMode, DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED);
      assertEquals(
        bytesToHex(after.encryptedMasterKey as Uint8Array),
        bytesToHex(before.encryptedMasterKey as Uint8Array),
      );
    });
  },
);

Deno.test(
  "checkPermission denies when required level is not met (pure read, no mutation)",
  async () => {
    const environmentId = freshEnvironmentId();
    const userId = "user_" + bytesToHex(nodeRandomBytes(6));
    const documentId = "doc_" + bytesToHex(nodeRandomBytes(6));
    const userMasterKey = freshKey32();

    await withTenant(environmentId, userId, async () => {
      await seed({
        environmentId,
        userId,
        documentId,
        permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        encryptionMode: DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
        userMasterKey,
      });

      const result = await service.checkPermission(
        documentId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
      );

      // READ < DOWNLOAD -> denied.
      assertEquals(result.hasPermission, false);
      assertEquals(result.currentLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.READ);

      const after = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(after.encryptionMode, DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC);
    });
  },
);

Deno.test(
  "checkPermission returns hasPermission=false with no currentLevel when the user has no access row",
  async () => {
    const environmentId = freshEnvironmentId();
    const userId = "user_" + bytesToHex(nodeRandomBytes(6));
    const documentId = "doc_" + bytesToHex(nodeRandomBytes(6));

    await withTenant(environmentId, userId, async () => {
      // Touch the tenant DB so it is created/migrated, but seed NO data-key row.
      await getTenantDB(environmentId);

      const result = await service.checkPermission(
        documentId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      );

      assertEquals(result.hasPermission, false);
      assertEquals(result.currentLevel, undefined);
    });
  },
);

// --- PermissionService.checkAccess (sibling smell; backlog #2) -------------
//
// PermissionService.checkAccess once carried the same hidden side effect as
// DataAccessService.checkPermission (lazy ASYMMETRIC→USER_CONTROLLED conversion
// when given a userMasterKey). That branch was dead — no caller ever passed a
// key — and was removed along with the `userMasterKey` parameter. These tests
// pin checkAccess as a pure read so the smell cannot silently return.

Deno.test(
  "PermissionService.checkAccess grants and is a PURE read (no mutation on ASYMMETRIC)",
  async () => {
    const environmentId = freshEnvironmentId();
    const userId = "user_" + bytesToHex(nodeRandomBytes(6));
    const documentId = "doc_" + bytesToHex(nodeRandomBytes(6));
    const userMasterKey = freshKey32();

    await withTenant(environmentId, userId, async () => {
      await seed({
        environmentId,
        userId,
        documentId,
        permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
        encryptionMode: DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
        userMasterKey,
      });

      const before = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(before.encryptionMode, DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC);

      const allowed = await permissionService.checkAccess(
        documentId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
      );
      assertEquals(allowed, true);

      const after = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(
        after.encryptionMode,
        DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
        "checkAccess must not persist a key-type conversion",
      );
      assertEquals(
        bytesToHex(after.encryptedMasterKey as Uint8Array),
        bytesToHex(before.encryptedMasterKey as Uint8Array),
        "checkAccess must not rewrite encrypted_master_key",
      );
    });
  },
);

Deno.test(
  "PermissionService.checkAccess denies when the required level is not met",
  async () => {
    const environmentId = freshEnvironmentId();
    const userId = "user_" + bytesToHex(nodeRandomBytes(6));
    const documentId = "doc_" + bytesToHex(nodeRandomBytes(6));
    const userMasterKey = freshKey32();

    await withTenant(environmentId, userId, async () => {
      await seed({
        environmentId,
        userId,
        documentId,
        permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        encryptionMode: DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
        userMasterKey,
      });

      const allowed = await permissionService.checkAccess(
        documentId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
      );
      assertEquals(allowed, false);

      // Denied, and still no mutation.
      const after = await readDataKeyRow(environmentId, documentId, userId);
      assertEquals(after.encryptionMode, DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC);
    });
  },
);

Deno.test(
  "PermissionService.checkAccess returns false when the user has no access row",
  async () => {
    const environmentId = freshEnvironmentId();
    const userId = "user_" + bytesToHex(nodeRandomBytes(6));
    const documentId = "doc_" + bytesToHex(nodeRandomBytes(6));

    await withTenant(environmentId, userId, async () => {
      await getTenantDB(environmentId);

      const allowed = await permissionService.checkAccess(
        documentId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      );
      assertEquals(allowed, false);
    });
  },
);
