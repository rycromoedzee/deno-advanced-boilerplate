/**
 * @file handlers/auth/magic.handler.ts
 * @description Magic-link authentication handlers (request + consume).
 *
 * Security contract (plans/2026-06-20-magic-link-security-hardening.md and
 * plans/2026-06-22-magic-link-e2ee-conditional-login.md):
 *   - Request (POST /magic/request): resolves the user server-side (F5), emails
 *     a context-bound one-time link, and ALWAYS returns the same generic 202
 *     whether or not the email exists (G4 / no enumeration).
 *   - Consume (POST /magic/consume, G1): redeems the token from the request
 *     body (never a URL) and records consumption telemetry. Completion is now
 *     E2EE-CONDITIONAL (G2-C, replacing G2-i), routed by decideMagicLinkCompletion:
 *       * E2EE OFF + no 2FA  -> mint a key-less session now (200 direct-login).
 *         Document data uses the app-controlled key, so no master key is needed —
 *         identical to a passkey login's key-less session.
 *       * E2EE OFF + 2FA on  -> issue a 2FA challenge carrying NO derived key;
 *         the shared two-factor handler completes the key-less session (202).
 *       * E2EE ON + passkey + no 2FA -> hand off to passkey-login (PRF unwrap, 202).
 *       * E2EE ON without a wired unwrap path -> honest refusal (403/409), never a
 *         session that cannot read the user's master-key-wrapped data.
 *     The token core (CSPRNG/hash/atomic-single-use/user-binding/TTL/JWT claims)
 *     is unchanged and sound.
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { magicLinkConsumeRoute, magicLinkRequestRoute } from "@routes/auth/magic.route.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { AuthTokenHelperService, decideMagicLinkCompletion, getAuthMagicService, hashUserAgent } from "@services/auth/index.ts";
import { AUTH_HEADER_NAMING, getSessionCreateService } from "@services/session/index.ts";
import { getUserAsymmetricKeysService } from "@services/user/index.ts";
import { useSetCookie, useSetSessionKeyCookie, useSetSignedCookie } from "@utils/cookie.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/index.ts";
import { SchemaMagicLinkConsumeResponse, SchemaMagicLinkRequestResponse } from "@models/auth/auth-response.model.ts";

/** Identical acknowledgement for known and unknown emails (G4). */
const MAGIC_LINK_GENERIC_REQUEST_MESSAGE = "If that account exists, a sign-in link is on its way.";

/**
 * POST /api/auth/magic/request
 * Sends a one-time magic sign-in link (or silently no-ops for unknown emails).
 */
export const magicLinkRequestHandler = defineHandler(
  {
    route: magicLinkRequestRoute,
    operationName: "auth_magic_link_request",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaMagicLinkRequestResponse,
  },
  async ({ c, body, traceService }) => {
    const startTime = performance.now();
    const { email } = body;

    const requestContext = IPLookupUtils.getRequestContext(c);
    const context = {
      creatorIP: requestContext.ip,
      creatorUAHash: hashUserAgent(requestContext.userAgent),
    };

    traceService.addBreadcrumb("auth", "Magic-link request", "info", {
      hasEmail: !!email,
    });

    // Service resolves the user server-side, applies the email-bomb throttle,
    // generates the context-bound token, and queues the email. It silently
    // no-ops when the email is unknown.
    await getAuthMagicService().requestMagicLink(email, context).catch(async (error) => {
      // A generate/send failure must NOT leak account state — swallow it and fall
      // through to the generic 202 (G4). requestMagicLink runs under
      // tracedWithServiceErrorHandling, which already logs 5xx service-boundary
      // failures (flagged _serviceErrorLogged); only log here for genuinely
      // unexpected values to avoid duplicate error entries (references/error-handling.md).
      const alreadyLogged = error instanceof AppHttpException && error._serviceErrorLogged;
      if (!alreadyLogged) {
        await useLogger(LoggerLevels.error, {
          messageKey: "auth.magic-link.request-error",
          section: loggerAppSections.AUTH,
          message: "Magic-link request failed; returning generic response",
          details: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    });

    // Timing floor (G4): ensureMinimumProcessingTime pads to a minimum but is NOT
    // constant-time — the known-email path does extra synchronous work (token
    // sign, cache writes, email-row insert) that the unknown path skips, so a
    // residual timing difference remains. Per G4 this residual is ACCEPTED: the
    // primary enumeration defense is the identical response body + zero
    // account-state side effects. Fully equalizing the work is future hardening.
    await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);

    return {
      data: { message: MAGIC_LINK_GENERIC_REQUEST_MESSAGE },
      status: 202 as const,
    };
  },
);

/**
 * POST /api/auth/magic/consume
 * Redeems a one-time magic link, verifies identity, and returns the next step.
 */
export const magicLinkConsumeHandler = defineHandler(
  {
    route: magicLinkConsumeRoute,
    operationName: "auth_magic_link_consume",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaMagicLinkConsumeResponse,
  },
  async ({ c, body, traceService }) => {
    const { token } = body;

    const requestContext = IPLookupUtils.getRequestContext(c);
    const consumerContext = {
      creatorIP: requestContext.ip,
      creatorUAHash: hashUserAgent(requestContext.userAgent),
    };
    const deviceInfo = {
      userAgent: requestContext.userAgent,
      accept: requestContext.headers["accept"] || "unknown",
      lang: requestContext.headers["Accept-Language"] || "unknown",
    };

    // 1. Verify the one-time token (atomic single-use; mismatch logged, never
    //    blocks — G3). Throws AUTH.UNAUTHORIZED on any failure.
    const { userId } = await getAuthMagicService().verifyMagicLink(token, consumerContext);
    traceService.addBreadcrumb("auth", "Magic link verified", "info", { userId });

    // 2. Resolve consumer state (E2EE flag + 2FA + key-bearing factors).
    const resolution = await getAuthMagicService().resolveMagicLinkConsumer(userId);

    // 3. Decide the completion path (pure, unit-tested — G2-C).
    const decision = decideMagicLinkCompletion({
      isEnhancedEncryptionEnabled: resolution.isEnhancedEncryptionEnabled,
      isTwoFactorEnabled: resolution.isTwoFactorEnabled,
      hasPasskey: resolution.hasPasskey,
      hasRecoveryPhrase: resolution.hasRecoveryPhrase,
    });
    traceService.addBreadcrumb("auth", "Magic link completion decided", "info", {
      kind: decision.kind,
    });

    switch (decision.kind) {
      case "direct-session": {
        // E2EE OFF + no 2FA: data uses the app-controlled key, so no master key
        // is needed. Mint a full key-less session (mirrors passkey logins).
        const sessionResult = await getSessionCreateService().createUserSession(
          userId,
          deviceInfo,
          requestContext.ip,
          c,
          false,
          undefined,
        ).catch(async (error) => {
          await useLogger(LoggerLevels.error, {
            messageKey: "auth.session-creation-error",
            section: loggerAppSections.AUTH,
            message: "Session creation failed during magic-link consume",
            details: {
              userId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          throwHttpError("AUTH.SESSION_CREATION_FAILED");
        });

        // Non-fatal if the master key is unavailable (key-less session has none).
        await getUserAsymmetricKeysService().ensureKeyPairFromSession(
          userId,
          sessionResult.accessToken,
          undefined,
          undefined,
          sessionResult.sessionKey,
          resolution.environmentId,
        );

        useSetCookie(c, AUTH_HEADER_NAMING.access, sessionResult.accessToken, JWT_TOKEN_CONFIG.tokenTTL.authExpiration);
        await useSetSignedCookie(c, AUTH_HEADER_NAMING.refresh, sessionResult.refreshToken, JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration);
        useSetSessionKeyCookie(c, sessionResult.sessionKey, JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration);

        return {
          data: {
            message: "Sign-in successful",
            isAuthCompleted: true as const,
            nextStep: "direct-login" as const,
            userId,
            environmentId: resolution.environmentId,
            displayName: `${resolution.firstName ?? ""} ${resolution.lastName ?? ""}`.trim(),
          },
          status: 200 as const,
        };
      }

      case "two-factor": {
        // E2EE OFF + 2FA on: issue a 2FA challenge with NO derived key. The
        // shared two-factor handler completes a key-less session (Phase B).
        await AuthTokenHelperService.generateTwoFactorToken(
          c,
          userId,
          deviceInfo,
          requestContext.ip,
        );
        return {
          data: {
            message: "2FA verification required",
            isAuthCompleted: false as const,
            nextStep: "two-factor" as const,
            redirectTo: "/api/auth/two-factor",
          },
          status: 202 as const,
        };
      }

      case "passkey-unwrap": {
        // E2EE ON + passkey + no 2FA: hand off to passkey-login (PRF unwrap).
        // The passkey ceremony needs a username for /passkey/begin
        // (findUserByUsername); the magic link already proved email ownership, so
        // return it (and the email) to let the frontend start the ceremony without
        // re-prompting.
        return {
          data: {
            message: "Verify with your passkey to complete sign-in",
            isAuthCompleted: false as const,
            nextStep: "passkey-login" as const,
            redirectTo: "/api/auth/passkey/begin",
            username: resolution.username,
            email: resolution.email,
          },
          status: 202 as const,
        };
      }

      case "unsupported": {
        // E2EE ON without a wired unwrap path. Honest refusal — never mint a
        // session that cannot read the user's encrypted data.
        if (decision.reason === "key_factor_required") {
          throwHttpError("AUTH.MAGIC_LINK_KEY_FACTOR_REQUIRED"); // 403
        }
        throwHttpError("AUTH.MAGIC_LINK_COMPLETION_UNSUPPORTED"); // 409
      }
    }
  },
);
