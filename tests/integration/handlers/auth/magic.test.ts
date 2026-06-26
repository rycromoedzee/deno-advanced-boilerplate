/**
 * @file tests/integration/handlers/auth/magic.test.ts
 * @description Integration tests for the E2EE-conditional magic-link consume
 *   completion policy (G2-C). Exercises every row of the decision matrix in §1
 *   of plans/2026-06-22-magic-link-e2ee-conditional-login.md.
 *
 * Run: NODE_ENV=development TRACING_ENABLED=false RATE_LIMIT_ENABLED=false \
 *      deno test -A --no-check tests/integration/handlers/auth/magic.test.ts
 */
import { assertEquals } from "@std/assert";
import {
  cleanupMagicLinkUser,
  currentTotpCode,
  extractAccessToken,
  freshEnvironmentId,
  freshUserId,
  mintMagicToken,
  postConsume,
  postTwoFactor,
  seedMagicLinkUser,
} from "./_harness.ts";

/** Seeds a uniquely-identified consumer for one matrix row and returns its handles. */
function freshSeeds(tag: string) {
  return {
    environmentId: freshEnvironmentId(),
    userId: freshUserId(),
    email: `${tag}_${freshUserId()}@example.com`,
  };
}

// (a) E2EE off, no 2FA, password-only -> 200 direct-login + single-use replay -> 401
Deno.test("(a) E2EE off + no 2FA + password-only -> 200 direct-login; replay -> 401 (single-use)", async () => {
  const ids = freshSeeds("mla");
  const seeded = await seedMagicLinkUser({
    environmentId: ids.environmentId,
    userId: ids.userId,
    email: ids.email,
    e2ee: false,
    twoFactor: false,
    passkey: false,
    recovery: false,
  });
  try {
    const token = await mintMagicToken(ids.userId, seeded.email);

    // First consume -> 200 direct-login with the full cookie set.
    const res1 = await postConsume(token);
    const body1 = await res1.json() as Record<string, unknown>;
    assertEquals(res1.status, 200);
    assertEquals(body1.isAuthCompleted, true);
    assertEquals(body1.nextStep, "direct-login");
    assertEquals(body1.userId, ids.userId);
    assertEquals(body1.environmentId, ids.environmentId);
    const setCookie = res1.headers.get("set-cookie") ?? "";
    assertEquals(setCookie.includes("access_token="), true);
    assertEquals(setCookie.includes("refresh_token="), true);
    assertEquals(setCookie.includes("session_key="), true);

    // Same token again -> 401 (atomic single-use intact).
    const res2 = await postConsume(token);
    assertEquals(res2.status, 401);
    const body2 = await res2.json() as { messageKey?: string };
    assertEquals(body2.messageKey, "auth.not-authorized");
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});

// (b) E2EE off, 2FA on -> 202 two-factor, then valid TOTP -> 200 session
Deno.test("(b) E2EE off + 2FA on -> 202 two-factor, then TOTP -> 200 session", async () => {
  const ids = freshSeeds("mlb");
  const seeded = await seedMagicLinkUser({
    environmentId: ids.environmentId,
    userId: ids.userId,
    email: ids.email,
    e2ee: false,
    twoFactor: true,
    passkey: false,
    recovery: false,
  });
  try {
    const res = await postConsume(await mintMagicToken(ids.userId, seeded.email));
    const body = await res.json() as Record<string, unknown>;
    assertEquals(res.status, 202);
    assertEquals(body.isAuthCompleted, false);
    assertEquals(body.nextStep, "two-factor");
    assertEquals(body.redirectTo, "/api/auth/two-factor");

    // Consume set the key-less TWO_FACTOR challenge as the access cookie.
    const challenge = extractAccessToken(res.headers.get("set-cookie"));
    assertEquals(challenge !== null, true);
    const code = await currentTotpCode(seeded.totpEncryptedSecret!);

    // The shared two-factor handler completes a key-less session (Phase B).
    const res2 = await postTwoFactor(challenge!, code);
    assertEquals(res2.status, 200);
    const body2 = await res2.json() as Record<string, unknown>;
    assertEquals(body2.isAuthCompleted, true);
    assertEquals(body2.nextStep, "direct-login");
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});

// (c) E2EE on, passkey, no 2FA -> 202 passkey-login
Deno.test("(c) E2EE on + passkey + no 2FA -> 202 passkey-login", async () => {
  const ids = freshSeeds("mlc");
  const seeded = await seedMagicLinkUser({
    environmentId: ids.environmentId,
    userId: ids.userId,
    email: ids.email,
    e2ee: true,
    twoFactor: false,
    passkey: true,
    recovery: false,
  });
  try {
    const res = await postConsume(await mintMagicToken(ids.userId, seeded.email));
    const body = await res.json() as Record<string, unknown>;
    assertEquals(res.status, 202);
    assertEquals(body.isAuthCompleted, false);
    assertEquals(body.nextStep, "passkey-login");
    assertEquals(body.redirectTo, "/api/auth/passkey/begin");
    // The passkey ceremony needs a username for /passkey/begin (findUserByUsername).
    // The magic link already proved email ownership, so consume returns it to avoid
    // re-prompting — the frontend passes it straight to begin.
    assertEquals(body.username, seeded.username);
    assertEquals(body.email, seeded.email);
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});

// (d) E2EE on, password-only (no factor) -> 403 auth.magic-link-key-factor-required
Deno.test("(d) E2EE on + password-only (no factor) -> 403 auth.magic-link-key-factor-required", async () => {
  const ids = freshSeeds("mld");
  const seeded = await seedMagicLinkUser({
    environmentId: ids.environmentId,
    userId: ids.userId,
    email: ids.email,
    e2ee: true,
    twoFactor: false,
    passkey: false,
    recovery: false,
  });
  try {
    const res = await postConsume(await mintMagicToken(ids.userId, seeded.email));
    assertEquals(res.status, 403);
    const body = await res.json() as { messageKey?: string };
    assertEquals(body.messageKey, "auth.magic-link-key-factor-required");
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});

// (e) E2EE on, recovery-only, no 2FA -> 409 auth.magic-link-completion-unsupported
Deno.test("(e) E2EE on + recovery-only + no 2FA -> 409 auth.magic-link-completion-unsupported", async () => {
  const ids = freshSeeds("mle");
  const seeded = await seedMagicLinkUser({
    environmentId: ids.environmentId,
    userId: ids.userId,
    email: ids.email,
    e2ee: true,
    twoFactor: false,
    passkey: false,
    recovery: true,
  });
  try {
    const res = await postConsume(await mintMagicToken(ids.userId, seeded.email));
    assertEquals(res.status, 409);
    const body = await res.json() as { messageKey?: string };
    assertEquals(body.messageKey, "auth.magic-link-completion-unsupported");
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});

// (f) E2EE on, passkey + 2FA -> 409 auth.magic-link-completion-unsupported
Deno.test("(f) E2EE on + passkey + 2FA -> 409 auth.magic-link-completion-unsupported", async () => {
  const ids = freshSeeds("mlf");
  const seeded = await seedMagicLinkUser({
    environmentId: ids.environmentId,
    userId: ids.userId,
    email: ids.email,
    e2ee: true,
    twoFactor: true,
    passkey: true,
    recovery: false,
  });
  try {
    const res = await postConsume(await mintMagicToken(ids.userId, seeded.email));
    assertEquals(res.status, 409);
    const body = await res.json() as { messageKey?: string };
    assertEquals(body.messageKey, "auth.magic-link-completion-unsupported");
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});

// (g) Context mismatch (different IP/UA) is logged, NOT blocked -> still completes (G3)
Deno.test("(g) context mismatch is logged, not blocked -> still completes (G3)", async () => {
  const ids = freshSeeds("mlg");
  const seeded = await seedMagicLinkUser({
    environmentId: ids.environmentId,
    userId: ids.userId,
    email: ids.email,
    e2ee: false,
    twoFactor: false,
    passkey: false,
    recovery: false,
  });
  try {
    // Mint from one context (TEST-NET-3 IP), consume from a clearly different one
    // (TEST-NET-2 IP + different UA). Both are valid non-private IPs so
    // extractIPFromRequest honors X-Forwarded-For deterministically.
    const token = await mintMagicToken(ids.userId, seeded.email, "203.0.113.42");
    const res = await postConsume(token, { ip: "198.51.100.7", userAgent: "ConsumeUA/2.0" });
    const body = await res.json() as Record<string, unknown>;
    // Mismatch is logged (high severity) but NEVER blocks login (G3).
    assertEquals(res.status, 200);
    assertEquals(body.isAuthCompleted, true);
    assertEquals(body.nextStep, "direct-login");
  } finally {
    await cleanupMagicLinkUser(seeded);
  }
});
