/**
 * @file tests/integration/services/encryption/enable-e2ee-derived-key.test.ts
 * @description Invariant the enhanced-encryption opt-in handler relies on: when a
 *   key-less session (e.g. magic-link direct-login) enables E2EE, the password-
 *   derived key must be stored on the REFRESH token — not just the access token —
 *   so it survives token rotation (`reCacheEncryptionKeys` reads it back from the
 *   refresh token). Without that, the key is lost ~15 min later (first rotation)
 *   and the user must re-login.
 *
 * This exercises the real storage path (createUserSession → real access/refresh/
 * session-key tokens) and the same helpers the handler calls, proving the
 * round-trip works for a key-less session. (Driving the opt-in endpoint itself
 * needs authenticated-request test infrastructure that doesn't yet exist in the
 * repo; the handler call site mirrors password login exactly.)
 *
 * Run: NODE_ENV=development TRACING_ENABLED=false RATE_LIMIT_ENABLED=false \
 *      deno test -A --no-check tests/integration/services/encryption/enable-e2ee-derived-key.test.ts
 */
import { assertEquals } from "@std/assert";
import { bytesToHex, eq, nodeRandomBytes } from "@deps";

import { requestContext } from "@db/context.ts";
import { evictTenantDB, getGlobalDB, getTenantDB, globalTables, tenantDbPath, tenantTables } from "@db/index.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { getSessionCreateService } from "@services/session/index.ts";
import { getUserMasterKeySetupService } from "@services/auth/index.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { TextTransformations } from "@utils/text/index.ts";

const DEVICE = { userAgent: "TestUA/1.0", accept: "application/json", lang: "en" };

/** A fresh non-private IP per call so session-creation rate-limit counters never accumulate. */
function freshIp(): string {
  return `198.51.100.${(nodeRandomBytes(1)[0]! % 200) + 2}`;
}

/** Seeds an E2EE-off user with a real password-wrapped master key (what registration does). */
async function seedUser(environmentId: string, userId: string, email: string, password: string): Promise<void> {
  const gdb = getGlobalDB();
  await gdb.insert(globalTables.environments).values({ id: environmentId, name: "E2EE Test Env" });
  await gdb.insert(globalTables.users).values({
    id: userId,
    email,
    firstName: "E2EE",
    lastName: "Tester",
    environmentId,
    isActive: true,
  });
  await requestContext.run(
    { environmentId, userId },
    async () => {
      const tdb = await getTenantDB(environmentId);
      await tdb.insert(tenantTables.userProfiles).values({ userId });
      // Generates the salt + a master key wrapped by the password-derived key, so
      // enableEnhancedEncryption (and generatePasswordDerivedKey) can run.
      await getUserMasterKeySetupService().setupForPasswordRegistration(userId, password, environmentId);
    },
  );
}

async function cleanup(environmentId: string, userId: string): Promise<void> {
  const gdb = getGlobalDB();
  try {
    await gdb.delete(globalTables.users).where(eq(globalTables.users.id, userId));
    await gdb.delete(globalTables.environments).where(eq(globalTables.environments.id, environmentId));
  } catch (error) {
    console.error("e2ee test cleanup error:", error);
  }
  evictTenantDB(environmentId);
  try {
    await Deno.remove(tenantDbPath(environmentId).replace("file:", ""));
  } catch { /* best effort */ }
}

/** Creates a key-less session (no derived key) — exactly what magic-link direct-login produces. */
async function createKeylessSession(userId: string) {
  return await getSessionCreateService().createUserSession(
    userId,
    DEVICE,
    freshIp(),
    undefined as never, // _honoContext is unused by createUserSession
    false,
    undefined, // no derived key → key-less session
  );
}

Deno.test(
  "enable-E2EE from a key-less session: derived key stored on the refresh token survives rotation",
  async () => {
    const environmentId = "T" + bytesToHex(nodeRandomBytes(12)).slice(0, 24);
    const userId = "e2eek_" + bytesToHex(nodeRandomBytes(6));
    const password = "Sup3rSecret!passw0rd-" + bytesToHex(nodeRandomBytes(2));

    await seedUser(environmentId, userId, `e2eek_${bytesToHex(nodeRandomBytes(4))}@example.com`, password);
    try {
      const session = await createKeylessSession(userId);
      const derivedKey = await EncryptionSystemUserService.generatePasswordDerivedKey(password, userId);
      const derivedKeyB64 = TextTransformations.fromBufferToBase64(derivedKey);

      // Mirror the FIXED opt-in handler: store on BOTH access and refresh tokens.
      await EncryptionSystemUserService.storePasswordDerivedKeyInCache(
        session.accessToken,
        JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
        derivedKeyB64,
        session.sessionKey,
      );
      await EncryptionSystemUserService.storePasswordDerivedKeyWithRefreshToken(
        session.refreshToken,
        JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
        derivedKeyB64,
        session.sessionKey,
      );

      // reCacheEncryptionKeys reads the derived key back from the refresh token.
      const recovered = await EncryptionSystemUserService.fetchPasswordDerivedKeyFromRefreshToken(
        session.refreshToken,
        session.sessionKey,
      );
      assertEquals(recovered, derivedKeyB64);
    } finally {
      await cleanup(environmentId, userId);
    }
  },
);

Deno.test(
  "WITHOUT the refresh-token store (pre-fix behavior), the derived key is NOT retrievable after rotation",
  async () => {
    const environmentId = "T" + bytesToHex(nodeRandomBytes(12)).slice(0, 24);
    const userId = "e2eek_" + bytesToHex(nodeRandomBytes(6));
    const password = "Sup3rSecret!passw0rd-" + bytesToHex(nodeRandomBytes(2));

    await seedUser(environmentId, userId, `e2eek_${bytesToHex(nodeRandomBytes(4))}@example.com`, password);
    try {
      const session = await createKeylessSession(userId);
      const derivedKey = await EncryptionSystemUserService.generatePasswordDerivedKey(password, userId);
      const derivedKeyB64 = TextTransformations.fromBufferToBase64(derivedKey);

      // Pre-fix behavior: access-token store ONLY.
      await EncryptionSystemUserService.storePasswordDerivedKeyInCache(
        session.accessToken,
        JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
        derivedKeyB64,
        session.sessionKey,
      );

      const recovered = await EncryptionSystemUserService.fetchPasswordDerivedKeyFromRefreshToken(
        session.refreshToken,
        session.sessionKey,
      );
      assertEquals(recovered, null); // the gap: key lost on the first rotation
    } finally {
      await cleanup(environmentId, userId);
    }
  },
);
