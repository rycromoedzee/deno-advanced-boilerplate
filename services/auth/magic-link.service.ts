/**
 * @file services/auth/magic-link.service.ts
 * @description Magic link token generation, verification, and orchestration for
 * passwordless authentication.
 *
 * Security contract (see plans/2026-06-20-magic-link-security-hardening.md):
 *   - Token core is UNCHANGED and sound: CSPRNG 128-bit entropy (EdDSA JWT),
 *     hashed-only storage (blake3), atomic single-use via cache.getAndDelete,
 *     constant-time user binding (safeEqual), short TTL (600s), and full JWT
 *     signature/iss/aud/exp/nbf/iat + type validation. Do NOT "harden" these.
 *   - NEW (Phase A): request-context binding + consumption/issuance telemetry,
 *     mirroring SecureReauthTokenService's log-only IP-mismatch precedent.
 *     Context comparison is LOG-ONLY and NEVER blocks login (Decision Gate G3):
 *     mobile cell↔Wi-Fi flips, CGNAT, IPv6 RFC 4941 rotation, VPN/proxy egress,
 *     and legitimate multi-device use all change IP/UA legitimately.
 *   - The raw User-Agent is NEVER persisted — only its normalized blake3 hash.
 *   - Email PII is never written to spans/logs (F4): `email` lives only inside
 *     the signed JWT.
 *   - Services are context-free: they accept primitives (creatorIP, a UA-hash
 *     context) — never a HonoContext.
 */

import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getTokenHelperService, ITokensPayloadJWT, tokenHashString } from "@services/token/index.ts";
import { getTimeNow, safeEqual } from "@utils/shared/index.ts";
import { loggerAppSections, LoggerLevels, useLogSecurityEvent } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { eq } from "@deps";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { envConfig } from "@config/env.ts";
import { getEmailSenderService } from "@services/mailer/index.ts";
import { detectContextMismatch, type MagicLinkContext } from "./magic-link-context.helper.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Cache entry stored for magic-link token validation. Carries the request
 * context captured at issuance so verify can compare (log-only) against the
 * consuming client. Raw UA is never stored — only its hash.
 */
type MagicTokenCacheEntry = {
  userId: string;
  creatorIP: string;
  creatorUAHash: string;
  createdAt: number;
};

/**
 * Resolved consumer state for magic-link consume. Drives the handler's completion
 * decision via decideMagicLinkCompletion (Decision Gate G2-C).
 */
export type MagicLinkConsumerResolution = {
  /** Whether the user has enhanced (E2EE) encryption enabled — the master-key gate. */
  isEnhancedEncryptionEnabled: boolean;
  isTwoFactorEnabled: boolean;
  /** Has at least one registered passkey (PRF unwrap path). */
  hasPasskey: boolean;
  /** Has a recovery phrase set (independent unwrap path). */
  hasRecoveryPhrase: boolean;
  firstName: string | null;
  lastName: string | null;
  environmentId: string;
  /**
   * The user's username (global.users.username) — returned so the passkey-login
   * handoff can start the ceremony without re-prompting (the magic link already
   * proved email ownership). Nullable: not every account sets one.
   */
  username: string | null;
  /** The user's email — surfaced for the passkey-login handoff (display/fallback). */
  email: string | null;
};

/** Email-bomb throttle: max link-email requests per user per fixed window. */
const MAGIC_REQUEST_MAX = 3;
const MAGIC_REQUEST_WINDOW_SECONDS = 300; // 5 minutes

/** Anchored-window throttle counter (mirrors middleware/rate-limit.middleware.ts). */
type MagicRequestThrottle = { count: number; firstRequest: number };

// ============================================================================
// Magic Link Authentication Service
// ============================================================================

/**
 * Magic Link Authentication Service
 * Handles magic link token generation, verification, and the request/consume
 * orchestration for passwordless authentication.
 */
export class AuthMagicService {
  /**
   * Generates a magic link token for user authentication and stores its hash in cache.
   * @param userId - The unique identifier of the user.
   * @param email - The user's email address (embedded in the signed JWT only; never logged).
   * @param context - Request context captured at issuance (creator IP + UA hash) for log-only comparison at verify.
   * @returns Promise<string> The generated JWT token.
   * @throws AppHttpException with 500 status if token generation or cache operations fail
   * @sideEffects Deletes and sets cache entries.
   */
  async generateMagicLink(
    userId: string,
    email: string,
    context: MagicLinkContext,
  ): Promise<string> {
    return await tracedWithServiceErrorHandling(
      "AuthMagicService.generateMagicLink",
      {
        service: "AuthMagicService",
        method: "generateMagicLink",
        section: loggerAppSections.AUTH,
        details: { userId, hasEmail: !!email }, // email PII redacted (F4)
      },
      "AUTH.MAGIC_KEY_GENERATE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["has_email"] = !!email;

        const cache = await getCache();

        // Remove any previous magic token for this user (best-effort cleanup)
        const previousTokenHash = await cache.get<string>(
          CACHE_NAMESPACES.AUTH.MAGIC_USER,
          userId,
        );
        if (previousTokenHash) {
          await cache.delete(
            CACHE_NAMESPACES.AUTH.MAGIC_TOKEN,
            previousTokenHash,
          );
        }

        const token = await getTokenHelperService().signTokenJWT(
          JWT_TOKEN_CONFIG.tokenTTL.magic,
          userId,
          JWT_TOKEN_TYPES.MAGIC,
          JWT_TOKEN_CONFIG.audiences.magic,
          {
            email, // email remains inside the signed JWT only; not in spans/logs (F4)
          },
        );

        const tokenHash = tokenHashString(token);

        await Promise.all([
          cache.set(
            CACHE_NAMESPACES.AUTH.MAGIC_TOKEN,
            tokenHash,
            {
              userId,
              creatorIP: context.creatorIP,
              creatorUAHash: context.creatorUAHash,
              createdAt: getTimeNow(),
            } satisfies MagicTokenCacheEntry,
            { ttl: JWT_TOKEN_CONFIG.tokenTTL.magic },
          ),
          cache.set(
            CACHE_NAMESPACES.AUTH.MAGIC_USER,
            userId,
            tokenHash,
            { ttl: JWT_TOKEN_CONFIG.tokenTTL.magic },
          ),
        ]);

        span.attributes["success"] = true;
        return token;
      },
      {
        logOverrides: {
          message: "Unexpected error generating magic link",
          messageKey: "auth.generate_magic_link.unexpected_error",
        },
      },
    );
  }

  /**
   * Verifies a magic link JWT token.
   *
   * @param token - The JWT token to verify.
   * @param consumerContext - The consuming client's request context (IP + UA hash),
   *   compared log-only against the issuer's captured context (never blocks; G3).
   * @returns Promise<{ userId: string }> The user ID if verification succeeds.
   * @throws AppHttpException with 401 status if token is invalid, revoked, or user is not authenticated
   * @throws AppHttpException with 500 status if unexpected errors occur
   * @sideEffects Atomically consumes the token (single-use) and may throw HTTP exceptions.
   */
  async verifyMagicLink(
    token: string,
    consumerContext: MagicLinkContext,
  ): Promise<{ userId: string }> {
    return await tracedWithServiceErrorHandling(
      "AuthMagicService.verifyMagicLink",
      {
        service: "AuthMagicService",
        method: "verifyMagicLink",
        section: loggerAppSections.AUTH,
        details: { tokenProvided: !!token },
      },
      "AUTH.UNAUTHORIZED",
      async (span) => {
        span.attributes["token_provided"] = !!token;

        // Validate JWT signature, claims, and audience
        const payload = await getTokenHelperService().useVerifyTokenJWT(
          token,
          JWT_TOKEN_CONFIG.audiences.magic,
        ) as ITokensPayloadJWT;

        span.attributes["user_id"] = payload.sub;

        // Validate token type
        if (payload.type !== JWT_TOKEN_TYPES.MAGIC) {
          span.attributes["failure_reason"] = "invalid_token_type";
          await this.logMagicLinkValidationFailure(
            "invalid_token_type",
            payload.sub || "unknown",
            consumerContext,
          );
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        // Get cached token hash + issuer context
        const cache = await getCache();
        const providedTokenHash = tokenHashString(token);

        // Atomic single-use: getAndDelete guarantees one redemption across all cache backends.
        const storedTokenData = await cache.getAndDelete<MagicTokenCacheEntry>(
          CACHE_NAMESPACES.AUTH.MAGIC_TOKEN,
          providedTokenHash,
        );

        // Validate stored token exists
        if (!storedTokenData) {
          span.attributes["failure_reason"] = "token_not_found";
          await this.logMagicLinkValidationFailure(
            "token_not_found",
            payload.sub,
            consumerContext,
          );
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        if (!safeEqual(storedTokenData.userId, payload.sub)) {
          span.attributes["failure_reason"] = "token_user_mismatch";
          await this.logMagicLinkValidationFailure(
            "token_user_mismatch",
            payload.sub,
            consumerContext,
          );
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        // Log-only context comparison (NEVER blocks; see Decision Gate G3):
        // mobile cell<->wifi flips, CGNAT, IPv6 RFC4941 rotation, VPN/proxy
        // egress, and legitimate multi-device use all change IP legitimately.
        // A mismatch is only claimable when BOTH creator and consumer captured a
        // value, so older links never fire a false alarm.
        const mismatch = detectContextMismatch(
          {
            creatorIP: storedTokenData.creatorIP,
            creatorUAHash: storedTokenData.creatorUAHash,
          },
          consumerContext,
        );
        if (mismatch.ipMismatch || mismatch.uaMismatch) {
          await this.logMagicLinkContextMismatch(payload.sub, mismatch);
        }

        span.attributes["success"] = true;
        return { userId: payload.sub };
      },
      {
        logOverrides: {
          message: "Unexpected error in magic link verification",
          messageKey: "auth.verify_magic_link.unexpected_error",
        },
      },
    );
  }

  /**
   * Revokes any active magic link for a user (best-effort). Intended for
   * cross-feature invalidation (F12): call from password-change and logout
   * flows so a stolen-but-unconsumed link cannot be redeemed after the user
   * resets. Wiring into those flows is a separate follow-up.
   * @param userId - The user whose outstanding magic link should be revoked.
   */
  async revokeMagicLinkForUser(userId: string): Promise<void> {
    const cache = await getCache();
    const tokenHash = await cache.get<string>(
      CACHE_NAMESPACES.AUTH.MAGIC_USER,
      userId,
    );
    if (tokenHash) {
      await Promise.all([
        cache.delete(CACHE_NAMESPACES.AUTH.MAGIC_TOKEN, tokenHash),
        cache.delete(CACHE_NAMESPACES.AUTH.MAGIC_USER, userId),
      ]);
    }
  }

  /**
   * Orchestrates a magic-link REQUEST: resolves the user server-side (never
   * trusts a client userId — F5), enforces an email-bomb throttle, generates
   * the context-bound token, and queues the email. Silently no-ops when the
   * email is unknown so the handler can return an identical generic response
   * (Decision Gate G4 — no account-enumeration leak).
   *
   * @param email - The email to send the link to.
   * @param context - The requesting client's context (IP + UA hash), bound to the token.
   */
  async requestMagicLink(
    email: string,
    context: MagicLinkContext,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "AuthMagicService.requestMagicLink",
      {
        service: "AuthMagicService",
        method: "requestMagicLink",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const normalizedEmail = email.toLowerCase().trim();

        // Resolve the user server-side (never trust a client userId — F5).
        const [user] = await getGlobalDB()
          .select({
            id: globalTables.users.id,
            email: globalTables.users.email,
            environmentId: globalTables.users.environmentId,
            firstName: globalTables.users.firstName,
            lastName: globalTables.users.lastName,
          })
          .from(globalTables.users)
          .where(eq(globalTables.users.email, normalizedEmail))
          .limit(1);

        // SECURITY: silently no-op when the email is unknown — the handler
        // always returns the same generic 202, so no existence is leaked (G4).
        if (!user) {
          span.attributes["account_found"] = false;
          return;
        }
        span.attributes["account_found"] = true;
        span.attributes["user_id"] = user.id;

        // Email-bomb throttle (per-user ≈ per-email): caps the number of link
        // emails sent to one inbox per fixed window, so an attacker rotating IPs
        // cannot flood a real inbox. Keyed by userId (a CUID — not PII). Mirrors
        // the anchored-window rate-limit pattern in middleware/rate-limit.middleware.ts
        // (firstRequest + residual TTL), and the read-check-write is serialized
        // under a cache lock so concurrent fan-out cannot bypass the cap.
        // Over-limit or lock-contention → silently no-op (generic 202).
        const cache = await getCache();
        const throttleKey = `magic_req:${user.id}`;
        const now = getTimeNow();
        const windowMs = MAGIC_REQUEST_WINDOW_SECONDS * 1000;
        let allowed = false;
        try {
          allowed = await cache.withLock(
            `magic_req_lock:${user.id}`,
            async () => {
              const entry = await cache.get<MagicRequestThrottle>(
                CACHE_NAMESPACES.RATE_LIMITS,
                throttleKey,
              );
              const windowExpired = !entry || (now - entry.firstRequest) > windowMs;
              const current = windowExpired ? { count: 0, firstRequest: now } : entry;
              if (current.count >= MAGIC_REQUEST_MAX) return false;
              const updated = { count: current.count + 1, firstRequest: current.firstRequest };
              // Residual TTL anchored to the window start so the entry expires at a
              // fixed boundary instead of sliding forward on every request.
              const residualTtl = Math.ceil((current.firstRequest + windowMs - now) / 1000);
              await cache.set(
                CACHE_NAMESPACES.RATE_LIMITS,
                throttleKey,
                updated,
                { ttl: Math.max(residualTtl, 1) },
              );
              return true;
            },
            { ttlMs: 5_000 },
          );
        } catch {
          // Lock contention under concurrent fan-out — fail closed to preserve the cap.
          allowed = false;
        }
        if (!allowed) {
          span.attributes["throttled"] = true;
          return;
        }

        // Resolve the user's preferred language from the tenant profile.
        const tenantDb = await getTenantDB(user.environmentId);
        const [profile] = await tenantDb
          .select({ language: tenantTables.userProfiles.language })
          .from(tenantTables.userProfiles)
          .where(eq(tenantTables.userProfiles.userId, user.id))
          .limit(1);
        const language = profile?.language ?? "en";

        // Generate the link + send it. Email is embedded only in the signed JWT
        // and the rendered template — never in spans/logs (F4).
        const toEmail = user.email ?? normalizedEmail;
        const fullName = `${user.firstName} ${user.lastName}`.trim();
        const token = await this.generateMagicLink(user.id, toEmail, context);
        const loginURL = `https://${envConfig.public.frontURL}/auth/magic-login/${encodeURIComponent(token)}`;

        await getEmailSenderService().useSendEmail(
          user.id,
          toEmail,
          { email: toEmail, loginURL, fullName } as unknown as JSON,
          "magic-link",
          language,
        );
      },
    );
  }

  /**
   * Resolves a magic-link-authenticated user's consume state — the facts that
   * drive the completion decision. Under G2-C the gate itself is no longer
   * enforced here: the handler routes via decideMagicLinkCompletion, keyed on
   * the E2EE flag. E2EE-off accounts (including password-only) complete via a
   * key-less session; only E2EE-on accounts without a wired unwrap factor are
   * refused, and that refusal happens in the handler (not here).
   *
   * @param userId - The user authenticated by verifyMagicLink.
   * @returns The user's E2EE flag, 2FA flag, available key-bearing factors, and profile.
   * @throws AUTH.UNAUTHORIZED if the user no longer exists.
   */
  async resolveMagicLinkConsumer(
    userId: string,
  ): Promise<MagicLinkConsumerResolution> {
    return await tracedWithServiceErrorHandling(
      "AuthMagicService.resolveMagicLinkConsumer",
      {
        service: "AuthMagicService",
        method: "resolveMagicLinkConsumer",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const globalDb = getGlobalDB();
        const [user] = await globalDb
          .select({
            id: globalTables.users.id,
            firstName: globalTables.users.firstName,
            lastName: globalTables.users.lastName,
            environmentId: globalTables.users.environmentId,
            isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
            username: globalTables.users.username,
            email: globalTables.users.email,
          })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId))
          .limit(1);

        if (!user) {
          span.attributes["failure_reason"] = "user_not_found";
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        // Key-bearing factors + E2EE flag (G2-C): the completion decision now
        // lives in decideMagicLinkCompletion (handler), fed by these resolved
        // facts. The master-key gate is the E2EE flag, NOT the presence of a
        // key-bearing factor — so this resolver no longer throws on a
        // password-only account (E2EE-off password-only users now complete via
        // a key-less session).
        const [passkeys, encryption] = await Promise.all([
          globalDb
            .select({ id: globalTables.userPasskeys.id })
            .from(globalTables.userPasskeys)
            .where(eq(globalTables.userPasskeys.userId, userId))
            .limit(1),
          (async () => {
            const tenantDb = await getTenantDB(user!.environmentId);
            const [enc] = await tenantDb
              .select({
                recovery: tenantTables.userEncryption
                  .userEncryptedRecoveryPhraseVerificationData,
                isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
              })
              .from(tenantTables.userEncryption)
              .where(eq(tenantTables.userEncryption.userId, userId))
              .limit(1);
            return enc;
          })(),
        ]);

        const hasPasskey = passkeys.length > 0;
        const hasRecoveryPhrase = !!encryption?.recovery;
        // No userEncryption row -> never set up -> default OFF (app-controlled key).
        const isEnhancedEncryptionEnabled = !!encryption?.isEnhancedEncryptionEnabled;

        span.attributes["success"] = true;
        span.attributes["has_2fa"] = !!user!.isTwoFactorEnabled;
        span.attributes["e2ee_enabled"] = isEnhancedEncryptionEnabled;

        return {
          isEnhancedEncryptionEnabled,
          isTwoFactorEnabled: !!user!.isTwoFactorEnabled,
          hasPasskey,
          hasRecoveryPhrase,
          firstName: user!.firstName ?? null,
          lastName: user!.lastName ?? null,
          environmentId: user!.environmentId,
          username: user!.username ?? null,
          email: user!.email ?? null,
        };
      },
    );
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Logs magic link validation failures for security monitoring, including the
   * anonymized consuming-client context (F7).
   * @param reason - Reason for validation failure
   * @param userId - User ID (safe to log)
   * @param consumerContext - The consuming client's context (IP anonymized for both v4/v6)
   */
  private async logMagicLinkValidationFailure(
    reason: string,
    userId: string,
    consumerContext: MagicLinkContext,
  ): Promise<void> {
    const severity = reason.includes("mismatch") || reason.includes("invalid") ? "high" : "medium";

    await useLogSecurityEvent(
      LoggerLevels.warn,
      `Magic link validation failed: ${reason}`,
      severity,
      loggerAppSections.AUTH,
      "Auth.Magic_Link_Validation_Failed",
      {
        reason,
        userId,
        // anonymized for BOTH ipv4 and ipv6 — never the raw address.
        // (Naive split(".")[0] returns the WHOLE ipv6 string — use IPLookupUtils.)
        consumerIp: IPLookupUtils.anonymizeIP(consumerContext.creatorIP),
        consumerUAHash: consumerContext.creatorUAHash || "unknown",
        timestamp: getTimeNow(),
      },
    );
  }

  /**
   * Log-only signal that the consuming client differs from the issuing client.
   * High severity when BOTH IP and UA change simultaneously (a strong theft
   * signal) — but this NEVER blocks login (see Decision Gate G3).
   */
  private async logMagicLinkContextMismatch(
    userId: string,
    mismatch: { ipMismatch: boolean; uaMismatch: boolean },
  ): Promise<void> {
    await useLogSecurityEvent(
      LoggerLevels.warn,
      "Magic link consumed from differing context",
      mismatch.ipMismatch && mismatch.uaMismatch ? "high" : "medium",
      loggerAppSections.AUTH,
      "Auth.Magic_Link_Context_Mismatch",
      {
        userId,
        ipMismatch: mismatch.ipMismatch,
        uaMismatch: mismatch.uaMismatch,
        timestamp: getTimeNow(),
      },
    );
  }
}
