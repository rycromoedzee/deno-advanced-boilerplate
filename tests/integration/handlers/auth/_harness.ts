/**
 * @file tests/integration/handlers/auth/_harness.ts
 * @description Shared seeding/mint/request helpers for magic-link + two-factor
 *   integration tests. Test-only (filename has no `test`/`spec` marker, so Deno's
 *   test discovery never runs it). Mirrors the proven seeding pattern from
 *   tests/integration/services/encryption/data-access.checkpermission.test.ts.
 *
 * Env required to run tests that import this: NODE_ENV=development (so db/db.ts
 * uses local file: SQLite + runs tenant migrations), TRACING_ENABLED=false,
 * RATE_LIMIT_ENABLED=false. The `.env` must provide the crypto secrets
 * (AUTH_GENERAL_ENCRYPTION_KEY, AUTH_JWT_PRIVATE_KEY/PUBLIC_KEY, AUTH_REFRESH_SECRET_KEY).
 */
import { bytesToHex, eq, nodeRandomBytes, OpenAPIHono } from "@deps";
import { assertEquals } from "@std/assert";

import { requestContext } from "@db/context.ts";
import { evictTenantDB, getGlobalDB, getTenantDB, globalTables, tenantDbPath, tenantTables } from "@db/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import {
  AuthMagicService,
  AuthTokenHelperService,
  AuthTOTPGenerationService,
  getAuthMagicService,
  hashUserAgent,
} from "@services/auth/index.ts";
import authApp from "@routes/auth/index.ts";

/** The two-factor challenge cookie name (AUTH_HEADER_NAMING.access). */
const ACCESS_COOKIE = "access_token";

/** A fresh, filesystem-safe environmentId (NanoID alphabet, 8-32 chars). */
export function freshEnvironmentId(): string {
  return "T" + bytesToHex(nodeRandomBytes(12)).slice(0, 24);
}

/** A unique user id (mirrors the encryption integration test convention). */
export function freshUserId(): string {
  return "mltest_" + bytesToHex(nodeRandomBytes(6));
}

export interface SeedUserOptions {
  environmentId: string;
  userId: string;
  email: string;
  /** Seed userEncryption.isEnhancedEncryptionEnabled = true (master-key gate). */
  e2ee: boolean;
  /** global.users.isTwoFactorEnabled + an active TOTP secret in the tenant DB. */
  twoFactor: boolean;
  /** Insert a global.userPasskeys row (PRF unwrap path). */
  passkey: boolean;
  /** Set userEncryptedRecoveryPhraseVerificationData (independent unwrap path). */
  recovery: boolean;
}

export interface SeededUser {
  environmentId: string;
  userId: string;
  email: string;
  /** The seeded global.users.username — what /passkey/begin expects. */
  username: string;
  /** Present only when `twoFactor: true` — pass to {@link currentTotpCode}. */
  totpEncryptedSecret?: Uint8Array;
}

const DEVICE_INFO = { userAgent: "TestUA/1.0", accept: "application/json", lang: "en" };

/**
 * Seeds a magic-link consumer into the global DB (environment + user + optional
 * passkey) and the tenant DB (profile + optional encryption row + optional TOTP
 * secret). Returns the seeded handles, including the encrypted TOTP secret when
 * 2FA is requested so tests can mint a valid code via {@link currentTotpCode}.
 */
export async function seedMagicLinkUser(opts: SeedUserOptions): Promise<SeededUser> {
  const gdb = getGlobalDB();

  // A unique username — required by /passkey/begin (findUserByUsername). Nullable
  // in the schema, but the passkey-unwrap path always has one.
  const username = `ml_${bytesToHex(nodeRandomBytes(4))}`;

  await gdb.insert(globalTables.environments).values({ id: opts.environmentId, name: "ML Test Env" });
  await gdb.insert(globalTables.users).values({
    id: opts.userId,
    email: opts.email,
    username,
    firstName: "Magic",
    lastName: "Tester",
    environmentId: opts.environmentId,
    isActive: true,
    isTwoFactorEnabled: opts.twoFactor,
  });

  if (opts.passkey) {
    await gdb.insert(globalTables.userPasskeys).values({
      id: generateIdRandom(),
      userId: opts.userId,
      publicKey: "test-pubkey",
      counter: 0,
      backedUp: false,
      transports: [],
    });
  }

  let totpEncryptedSecret: Uint8Array | undefined;

  await requestContext.run(
    { environmentId: opts.environmentId, userId: opts.userId },
    async () => {
      const tdb = await getTenantDB(opts.environmentId);
      await tdb.insert(tenantTables.userProfiles).values({ userId: opts.userId });

      if (opts.e2ee || opts.recovery) {
        await tdb.insert(tenantTables.userEncryption).values({
          userId: opts.userId,
          isEnhancedEncryptionEnabled: opts.e2ee,
          ...(opts.recovery ? { userEncryptedRecoveryPhraseVerificationData: new Uint8Array([1, 2, 3]) } : {}),
        });
      }

      if (opts.twoFactor) {
        const rawSecret = new Uint8Array(nodeRandomBytes(20));
        totpEncryptedSecret = await AuthTOTPGenerationService.encryptSecret(rawSecret);
        await tdb.insert(tenantTables.userTwoFactorSecrets).values({
          id: generateIdRandom(),
          userId: opts.userId,
          name: "Test TOTP",
          encryptedSecret: totpEncryptedSecret,
          isActive: true,
          isPrimary: true,
        });
      }
    },
  );

  return { environmentId: opts.environmentId, userId: opts.userId, email: opts.email, username, totpEncryptedSecret };
}

/** Removes the global rows + evicts/deletes the tenant DB for a seeded user. */
export async function cleanupMagicLinkUser(seeded: SeededUser): Promise<void> {
  const { environmentId, userId } = seeded;
  const gdb = getGlobalDB();
  try {
    await gdb.delete(globalTables.userPasskeys).where(eq(globalTables.userPasskeys.userId, userId));
    await gdb.delete(globalTables.users).where(eq(globalTables.users.id, userId));
    await gdb.delete(globalTables.environments).where(eq(globalTables.environments.id, environmentId));
  } catch (error) {
    console.error("magic-link test global cleanup error:", error);
  }
  evictTenantDB(environmentId);
  try {
    await Deno.remove(tenantDbPath(environmentId).replace("file:", ""));
  } catch { /* best effort */ }
}

/** Mints a one-time magic-link token directly (bypasses the email send). */
export async function mintMagicToken(
  userId: string,
  email: string,
  ip = "127.0.0.1",
): Promise<string> {
  return await getAuthMagicService().generateMagicLink(userId, email, {
    creatorIP: ip,
    creatorUAHash: hashUserAgent(DEVICE_INFO.userAgent),
  });
}

/**
 * POST /magic/consume through the real auth app. The `creatorContext` is derived
 * server-side from the request; pass `ip`/`userAgent` to exercise the (log-only)
 * context-mismatch telemetry deterministically.
 */
export async function postConsume(
  token: string,
  init?: { ip?: string; userAgent?: string },
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init?.ip) headers["X-Forwarded-For"] = init.ip;
  if (init?.userAgent) headers["User-Agent"] = init.userAgent;
  return await authApp.request("/magic/consume", {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
}

/** POST /two-factor through the real auth app, carrying a challenge cookie + code. */
export async function postTwoFactor(token: string, code: string, ip = "127.0.0.1"): Promise<Response> {
  return await authApp.request("/two-factor", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `${ACCESS_COOKIE}=${token}`,
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ code }),
  });
}

/** A valid TOTP code right now for a secret returned by {@link seedMagicLinkUser}. */
export async function currentTotpCode(encryptedSecret: Uint8Array): Promise<string> {
  return await AuthTOTPGenerationService.generateTOTP(encryptedSecret);
}

/**
 * Extracts the `access_token` cookie value from a `Set-Cookie` response header.
 * Used to carry a magic-link-issued 2FA challenge into the two-factor endpoint
 * (matrix row b).
 */
export function extractAccessToken(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${ACCESS_COOKIE}=([^;]+)`));
  return match ? match[1]! : null;
}

// --- key-less TWO_FACTOR challenge mint (for the 2FA backstop test) ----------
//
// The magic-link path issues 2FA challenges with NO password-derived key. To test
// the two-factor handler's E2EE-conditional gate in isolation we mint the same
// kind of challenge directly via the real AuthTokenHelperService, using a tiny
// throwaway app purely to obtain a Hono context (generateTwoFactorToken sets the
// challenge cookie on it as a side effect, which we ignore — we use the returned
// token string).

let challengeApp: OpenAPIHono | undefined;
function getChallengeApp(): OpenAPIHono {
  if (!challengeApp) {
    const app = new OpenAPIHono();
    app.post("/mint-2fa", async (c) => {
      const userId = c.req.header("x-user-id")!;
      const ip = c.req.header("x-ip") || "127.0.0.1";
      const token = await AuthTokenHelperService.generateTwoFactorToken(
        c,
        userId,
        DEVICE_INFO,
        ip,
      );
      return c.json({ token });
    });
    challengeApp = app;
  }
  return challengeApp;
}

/**
 * Mints a TWO_FACTOR challenge carrying NO password-derived key — exactly the
 * shape the magic-link 2FA handoff produces. Used to drive the two-factor
 * handler's E2EE-conditional gate without going through /magic/consume.
 */
export async function mintKeylessTwoFactorChallenge(
  userId: string,
  ip = "127.0.0.1",
): Promise<string> {
  const res = await getChallengeApp().request("/mint-2fa", {
    method: "POST",
    headers: { "x-user-id": userId, "x-ip": ip },
  });
  assertEquals(res.status, 200);
  const body = await res.json() as { token: string };
  return body.token;
}

/** Re-exported for tests that assert on the service-level resolve path. */
export { AuthMagicService };
