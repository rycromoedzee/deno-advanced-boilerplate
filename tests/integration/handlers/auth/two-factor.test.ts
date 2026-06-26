/**
 * @file tests/integration/handlers/auth/two-factor.test.ts
 * @description Backstop regression test for the E2EE-conditional derived-key gate
 *   in the shared two-factor completion handler (Phase B, Task B1 Step 3).
 *
 * INVARIANT: an E2EE-ENABLED user reaching the two-factor handler with a key-less
 * challenge (no stashed password-derived key — exactly the shape a magic-link 2FA
 * handoff produces) MUST be refused with 401 auth.creds-invalid. A regression that
 * drops the `hasEnhancedEncryptionEnabled` re-check would instead mint a session
 * and fail this test.
 *
 * Run: NODE_ENV=development TRACING_ENABLED=false RATE_LIMIT_ENABLED=false \
 *      deno test -A --no-check tests/integration/handlers/auth/two-factor.test.ts
 */
import { assertEquals } from "@std/assert";
import {
  cleanupMagicLinkUser,
  currentTotpCode,
  freshEnvironmentId,
  freshUserId,
  mintKeylessTwoFactorChallenge,
  postTwoFactor,
  seedMagicLinkUser,
} from "./_harness.ts";

Deno.test("2FA backstop: E2EE-enabled user + key-less challenge -> 401 auth.creds-invalid", async () => {
  const environmentId = freshEnvironmentId();
  const userId = freshUserId();
  const email = `ml2fa_${userId}@example.com`;

  const seeded = await seedMagicLinkUser({
    environmentId,
    userId,
    email,
    e2ee: true,
    twoFactor: true,
    passkey: false,
    recovery: false,
  });

  try {
    // Mint a TWO_FACTOR challenge carrying NO derived key (the magic-link shape).
    const challenge = await mintKeylessTwoFactorChallenge(userId);
    // A valid TOTP for the seeded secret so validation passes and we reach the gate.
    const code = await currentTotpCode(seeded.totpEncryptedSecret!);

    const res = await postTwoFactor(challenge, code);

    assertEquals(res.status, 401);
    const body = await res.json() as { messageKey?: string };
    assertEquals(body.messageKey, "auth.creds-invalid");
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});

Deno.test("2FA completion: E2EE-disabled user + key-less challenge -> 200 session (complementary positive case)", async () => {
  const environmentId = freshEnvironmentId();
  const userId = freshUserId();
  const email = `ml2fa_${userId}@example.com`;

  const seeded = await seedMagicLinkUser({
    environmentId,
    userId,
    email,
    e2ee: false,
    twoFactor: true,
    passkey: false,
    recovery: false,
  });

  try {
    const challenge = await mintKeylessTwoFactorChallenge(userId);
    const code = await currentTotpCode(seeded.totpEncryptedSecret!);

    const res = await postTwoFactor(challenge, code);

    assertEquals(res.status, 200);
    const body = await res.json() as { isAuthCompleted?: boolean; nextStep?: string };
    assertEquals(body.isAuthCompleted, true);
    assertEquals(body.nextStep, "direct-login");
    // A key-less session still sets the access cookie.
    assertEquals(res.headers.get("set-cookie")?.includes("access_token="), true);
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});
