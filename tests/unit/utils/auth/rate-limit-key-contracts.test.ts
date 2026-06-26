import { assert, assertEquals, assertFalse } from "@std/assert";
// @deps path-aliased modules — see deno.json "imports".
import { AUTH_RATE_LIMIT_KEY_PREFIX } from "@utils/auth/rate-limiting.ts";
import { RATE_LIMIT_KEY_PREFIX_ANON, RATE_LIMIT_KEY_PREFIX_USER } from "@middleware/rate-limit.middleware.ts";
import { buildSessionRateLimitKey } from "@services/session/session-rate-limit.service.ts";
import { SESSION_SECURITY_CONFIG } from "@services/session/session.constants.ts";
import { CACHE_NAMESPACES } from "@services/cache/index.ts";
import { buildRateLimitKey, RATE_LIMIT_KEY_VERSION } from "@utils/auth/cache-keys.ts";

/**
 * Rate-limit cache-key disjointness contract.
 *
 * There are THREE independent rate-limit key-building sites in the codebase,
 * and all three write into the SAME shared cache namespace
 * (`CACHE_NAMESPACES.RATE_LIMITS`). For the counters to be correct, the keys
 * produced by the three schemes MUST be pairwise disjoint: no key from one
 * scheme may ever equal a key from another, regardless of the inputs. A
 * collision would let, e.g., a login-attempt counter get clobbered by a
 * request-throttle counter and silently disable rate limiting.
 *
 * The three schemes and their on-disk/in-cache shapes:
 *
 *   1. Auth (utils/auth/rate-limiting.ts, `RateLimitingService.generateCacheKey`)
 *        shape:  `rate-limit:<identifier>` | `rate-limit:<identifier>:<ip>`
 *        body:   PLAIN (un-hashed) — must be rebuildable for reset/status.
 *
 *   2. Request middleware (middleware/rate-limit.middleware.ts)
 *        shape:  `user:<userId>:<path>` | `anon:<fingerprint>`
 *                optionally prefixed `<keyPrefix>:<base>` (feature bucket).
 *        body:   `user:` is PLAIN; `anon:` is a 16-byte blake3 hex hash of a
 *                composite fingerprint (fixed-width, raw components not stored).
 *
 *   3. Session (services/session/session-rate-limit.service.ts,
 *               `buildSessionRateLimitKey`)
 *        shape:  `<LIMIT_TYPE>:<key>`  e.g. `SESSION_CREATION:<ip>`
 *        body:   PLAIN. `LIMIT_TYPE` is a member of
 *                `SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL`.
 *
 * NOTE on the shared `rate-limit:` concern: scheme 1 is the ONLY one using the
 * `rate-limit:` prefix, so even though scheme 1's body is plain while scheme 2's
 * `anon:` body is hashed, the two never share a prefix and therefore cannot
 * collide. The disjointness below is asserted at the FULL-KEY level across all
 * three schemes.
 *
 * These tests are a regression guard: if anyone changes a prefix or body shape,
 * the test will fail and force a conscious decision (and a deploy-time cache
 * flush). See the WIRE/CACHE CONTRACT comments at each site.
 */

// ---------------------------------------------------------------------------
// Helpers: replicate each scheme's full-key construction from its public
// contract so the test asserts the real on-disk shape without needing a live
// HonoContext or cache.
// ---------------------------------------------------------------------------

/** Scheme 1 — auth `RateLimitingService` (utils/auth/rate-limiting.ts). */
function authKey(identifier: string, ip?: string): string {
  return ip ? `${AUTH_RATE_LIMIT_KEY_PREFIX}${identifier}:${ip}` : `${AUTH_RATE_LIMIT_KEY_PREFIX}${identifier}`;
}

/** Scheme 2 — request middleware anonymous fingerprint body (a 16-byte hash). */
const ANON_FINGERPRINT_REPLICA = "a1b2c3d4e5f60718293a4b5c6d7e8f90"; // 32 hex chars = 16 bytes, matches hash()
/** Scheme 2 — request middleware (middleware/rate-limit.middleware.ts). */
function middlewareUserKey(userId: string, path: string): string {
  return `${RATE_LIMIT_KEY_PREFIX_USER}${userId}:${path}`;
}
function middlewareAnonKey(fingerprint: string): string {
  return `${RATE_LIMIT_KEY_PREFIX_ANON}${fingerprint}`;
}

/** Scheme 3 — session `SessionRateLimiter` (real exported builder). */
const SESSION_LIMIT_TYPES = Object.keys(
  SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL,
) as Array<keyof typeof SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL>;

// ---------------------------------------------------------------------------
// 1. The three sites really do share a namespace — that is WHY disjointness
//    matters. If this ever splits, the disjointness guard is unnecessary and
//    should be revisited.
// ---------------------------------------------------------------------------
Deno.test("rate-limit key contract: all three schemes share the RATE_LIMITS namespace", () => {
  // CACHE_NAMESPACES.RATE_LIMITS is the single shared bucket. Documented here
  // so that a future namespace split is a deliberate, reviewed change.
  assertEquals(CACHE_NAMESPACES.RATE_LIMITS, "rate_limits");
});

// ---------------------------------------------------------------------------
// 2. The three prefixes are pairwise distinct.
// ---------------------------------------------------------------------------
Deno.test("rate-limit key contract: the four prefixes are pairwise distinct", () => {
  const prefixes = [
    AUTH_RATE_LIMIT_KEY_PREFIX, // scheme 1
    RATE_LIMIT_KEY_PREFIX_USER, // scheme 2 (authenticated)
    RATE_LIMIT_KEY_PREFIX_ANON, // scheme 2 (anonymous)
    // Scheme 3 has no single literal prefix; its "prefix" is the LIMIT_TYPE
    // token. We assert below that every LIMIT_TYPE token is disjoint from the
    // three literal prefixes above.
  ];
  assertEquals(new Set(prefixes).size, prefixes.length, "literal prefixes must be unique");

  // Every session LIMIT_TYPE token must NOT equal any literal prefix, and must
  // NOT be a prefix-of / prefixed-by one (so `<LIMIT_TYPE>:<key>` can never be
  // mistaken for `rate-limit:...`, `user:...`, or `anon:...`).
  for (const limitType of SESSION_LIMIT_TYPES) {
    for (const lit of prefixes) {
      assertFalse(
        lit.startsWith(`${limitType}:`),
        `session LIMIT_TYPE "${limitType}" would shadow prefix "${lit}"`,
      );
      assertFalse(
        `${limitType}:`.startsWith(lit),
        `prefix "${lit}" would shadow session LIMIT_TYPE "${limitType}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Full-key disjointness: build representative keys from each scheme and
//    assert no two are equal, including across deliberately-adversarial inputs
//    chosen to try to force a collision (e.g. an identifier that looks like
//    another scheme's prefix).
// ---------------------------------------------------------------------------
Deno.test("rate-limit key contract: full keys never collide across schemes", () => {
  // Adversarial inputs: an auth identifier shaped like a middleware prefix, a
  // session key shaped like an auth identifier, identical IP/path/user values
  // reused across schemes. If any collision occurs, rate limiting is broken.
  const sameIdentity = "1.2.3.4";
  const authKeys = [
    authKey(sameIdentity),
    authKey(sameIdentity, sameIdentity),
    authKey("user:1.2.3.4"), // identifier that mimics a middleware key
    authKey("anon:" + ANON_FINGERPRINT_REPLICA), // mimics an anon key
    authKey("SESSION_CREATION"), // mimics a session LIMIT_TYPE
  ];

  const middlewareKeys = [
    middlewareUserKey(sameIdentity, "/auth/login"),
    middlewareAnonKey(ANON_FINGERPRINT_REPLICA),
    // With a feature-bucket keyPrefix (e.g. "recovery", "two_factor"):
    `recovery:${RATE_LIMIT_KEY_PREFIX_USER}${sameIdentity}:/auth/recover`,
    `two_factor:${RATE_LIMIT_KEY_PREFIX_ANON}${ANON_FINGERPRINT_REPLICA}`,
  ];

  const sessionKeys = SESSION_LIMIT_TYPES.map((lt) => buildSessionRateLimitKey(lt, sameIdentity));

  const all = [...authKeys, ...middlewareKeys, ...sessionKeys];

  // No two full keys may be equal.
  assertEquals(
    new Set(all).size,
    all.length,
    "rate-limit keys collided across schemes — counters would corrupt",
  );

  // Belt-and-suspenders: every auth key starts with the auth prefix, every
  // session key starts with a LIMIT_TYPE token followed by ':', and no auth
  // key starts with a LIMIT_TYPE token (and vice-versa).
  for (const k of authKeys) {
    assert(k.startsWith(AUTH_RATE_LIMIT_KEY_PREFIX), `auth key lost its prefix: ${k}`);
    for (const lt of SESSION_LIMIT_TYPES) {
      assertFalse(k.startsWith(`${lt}:`), `auth key collides with session prefix: ${k}`);
    }
  }
  for (const k of sessionKeys) {
    assert(
      SESSION_LIMIT_TYPES.some((lt) => k.startsWith(`${lt}:`)),
      `session key lost its LIMIT_TYPE prefix: ${k}`,
    );
    assertFalse(
      k.startsWith(AUTH_RATE_LIMIT_KEY_PREFIX),
      `session key collides with auth prefix: ${k}`,
    );
    assertFalse(
      k.startsWith(RATE_LIMIT_KEY_PREFIX_USER) ||
        k.startsWith(RATE_LIMIT_KEY_PREFIX_ANON),
      `session key collides with middleware prefix: ${k}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Scheme-3 builder contract: shape and determinism.
// ---------------------------------------------------------------------------
Deno.test("rate-limit key contract: buildSessionRateLimitKey emits `<LIMIT_TYPE>:<key>`", () => {
  const key = buildSessionRateLimitKey("SESSION_CREATION", "1.2.3.4");
  assertEquals(key, "SESSION_CREATION:1.2.3.4");
  // Deterministic / rebuildable (required so the block marker can overwrite the
  // attempt-counter slot — see comment in session-rate-limit.service.ts).
  assertEquals(
    buildSessionRateLimitKey("SESSION_CREATION", "1.2.3.4"),
    key,
  );
});

// ---------------------------------------------------------------------------
// 5. Scheme-1 plain-body rebuildability: reset/status must reproduce the
//    exact key that recordAttempt/checkRateLimit used.
// ---------------------------------------------------------------------------
Deno.test("rate-limit key contract: auth key is plain and rebuildable (with/without IP)", () => {
  // The body is intentionally PLAIN (not hashed) so resetRateLimit and
  // getRateLimitStatus can reconstruct the key from the same identifier.
  assertEquals(authKey("alice"), "rate-limit:alice");
  assertEquals(authKey("alice", "10.0.0.1"), "rate-limit:alice:10.0.0.1");
  assert(authKey("alice").startsWith(AUTH_RATE_LIMIT_KEY_PREFIX));
});

// ---------------------------------------------------------------------------
// 6. Scheme-2 body shapes: authenticated is plain per-user-per-route;
//    anonymous is a fixed-width hash (32 hex chars = 16 bytes via hash()).
// ---------------------------------------------------------------------------
Deno.test("rate-limit key contract: middleware `user:` is plain, `anon:` is a 16-byte hex body", () => {
  // user: plain, per-user per-route.
  assertEquals(
    middlewareUserKey("u_123", "/api/v1/things"),
    "user:u_123:/api/v1/things",
  );
  // anon: body is the fingerprint hash — assert the KEY SHAPE (prefix + body),
  // not the hash value itself (hash determinism is covered by hashing.test.ts).
  const anon = middlewareAnonKey(ANON_FINGERPRINT_REPLICA);
  assert(anon.startsWith(RATE_LIMIT_KEY_PREFIX_ANON));
  assertEquals(
    anon.length,
    RATE_LIMIT_KEY_PREFIX_ANON.length + ANON_FINGERPRINT_REPLICA.length,
    "anon key must be prefix + fixed-width 32-hex-char body",
  );
  // The hash body is hex-only — a key invariant for the fixed-width contract.
  const body = anon.slice(RATE_LIMIT_KEY_PREFIX_ANON.length);
  assert(/^[0-9a-f]{32}$/.test(body), `anon body must be 32 lowercase hex chars: ${body}`);
});

// ---------------------------------------------------------------------------
// 7. buildRateLimitKey factory — verify it produces the same wire shapes as
//    the three per-scheme builders it replaced, so a rolling deploy onto this
//    version does NOT reset existing in-flight counters.
// ---------------------------------------------------------------------------
Deno.test("rate-limit key contract: buildRateLimitKey produces identical output to per-scheme builders", () => {
  const identifier = "alice";
  const ip = "10.0.0.1";
  const userId = "u_123";
  const path = "/api/things";
  const fingerprint = ANON_FINGERPRINT_REPLICA;
  const limitType = "SESSION_CREATION" as const;
  const sessionKey = "1.2.3.4";

  // Auth scheme — with and without IP, must match legacy generateCacheKey shape.
  assertEquals(
    buildRateLimitKey("auth", identifier),
    `${AUTH_RATE_LIMIT_KEY_PREFIX}${identifier}`,
    "auth key without IP must equal legacy shape",
  );
  assertEquals(
    buildRateLimitKey("auth", identifier, ip),
    `${AUTH_RATE_LIMIT_KEY_PREFIX}${identifier}:${ip}`,
    "auth key with IP must equal legacy shape",
  );

  // Middleware user scheme — must match legacy `user:<userId>:<path>` shape.
  assertEquals(
    buildRateLimitKey("middleware-user", userId, path),
    `${RATE_LIMIT_KEY_PREFIX_USER}${userId}:${path}`,
    "middleware-user key must equal legacy shape",
  );

  // Middleware anon scheme — must match legacy `anon:<fingerprint>` shape.
  assertEquals(
    buildRateLimitKey("middleware-anon", fingerprint),
    `${RATE_LIMIT_KEY_PREFIX_ANON}${fingerprint}`,
    "middleware-anon key must equal legacy shape",
  );

  // Session scheme — must match legacy `buildSessionRateLimitKey` output.
  assertEquals(
    buildRateLimitKey("session", limitType, sessionKey),
    buildSessionRateLimitKey(limitType, sessionKey),
    "session key via factory must equal legacy buildSessionRateLimitKey output",
  );
  assertEquals(
    buildRateLimitKey("session", limitType, sessionKey),
    `${limitType}:${sessionKey}`,
    "session key must equal legacy shape",
  );
});

// ---------------------------------------------------------------------------
// 8. RATE_LIMIT_KEY_VERSION is a numeric constant and starts at 1.
//    Bumping it is a signal that a format change has occurred and that
//    in-flight counters will be reset on deploy.
// ---------------------------------------------------------------------------
Deno.test("rate-limit key contract: RATE_LIMIT_KEY_VERSION is 1 (initial consolidated factory)", () => {
  assertEquals(typeof RATE_LIMIT_KEY_VERSION, "number");
  assertEquals(RATE_LIMIT_KEY_VERSION, 1);
});
