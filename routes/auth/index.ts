/**
 * @file routes/auth/index.ts
 * @description Auth routes with rate limiting
 */

import { createRateLimitedApp, type RateLimitOptions } from "@utils/openapi/openapi-wrapper.ts";
import { authLoginRoute } from "./login.route.ts";
import { magicLinkConsumeRoute, magicLinkRequestRoute } from "./magic.route.ts";
import { twoFactorAuthRoute } from "./two-factor.route.ts";

import { authRefreshRoute } from "./refresh.route.ts";
import { authLogoutRoute } from "./logout.route.ts";
import { registerPasskeyVerifyRoute, registerRoute, registerValidateRoute } from "./register.route.ts";
import { passkeyLoginBeginRoute, passkeyLoginVerifyRoute } from "./passkey.route.ts";
// Account Recovery Routes
import {
  recoveryBeginRoute,
  recoveryDisable2FARoute,
  recoveryResetPasswordRoute,
  recoverySendResetEmailRoute,
  recoveryVerifyBackupCodeRoute,
  recoveryVerifyEmailTokenRoute,
  recoveryVerifyPhraseRoute,
} from "./recovery.route.ts";
import {
  authChallengeHandler,
  authLoginHandler,
  authLogoutHandler,
  authRefreshHandler,
  magicLinkConsumeHandler,
  magicLinkRequestHandler,
  passkeyLoginBeginHandler,
  passkeyLoginVerifyHandler,
  recoveryBeginHandler,
  recoveryDisable2FAHandler,
  recoveryResetPasswordHandler,
  recoverySendResetEmailHandler,
  recoveryVerifyBackupCodeHandler,
  recoveryVerifyEmailTokenHandler,
  recoveryVerifyPhraseHandler,
  registerHandler,
  registerPasskeyVerifyHandler,
  registerValidateHandler,
  twoFactorAuthHandler,
} from "@handlers/auth/index.ts";

import { authChallengeRoute } from "./challenge.route.ts";

// Rate limit configurations
const AUTH_RATE_LIMIT: RateLimitOptions = {
  max: 99,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.2,
};

const STRICT_AUTH_RATE_LIMIT: RateLimitOptions = {
  max: 5,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.1,
};

const REFRESH_RATE_LIMIT: RateLimitOptions = {
  max: 30,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const REGISTER_RATE_LIMIT: RateLimitOptions = {
  max: 5,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.1,
};

const PASSKEY_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.2,
};

// Magic-link: strict on request (email-bomb defense, paired with the per-email
// throttle in the service); moderate on consume (token-bound, single-use).
const MAGIC_LINK_REQUEST_RATE_LIMIT: RateLimitOptions = {
  max: 5,
  window: 60 * 1000, // 1 minute
  blockDuration: 30 * 60 * 1000, // 30 minutes
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.1,
  keyPrefix: "magic-request",
};

const MAGIC_LINK_CONSUME_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.2,
  keyPrefix: "magic-consume",
};

const auth = createRateLimitedApp();

// Standard auth routes with rate limiting
auth.openapiWithRateLimit(authLoginRoute, authLoginHandler, AUTH_RATE_LIMIT);
auth.openapiWithRateLimit(twoFactorAuthRoute, twoFactorAuthHandler, STRICT_AUTH_RATE_LIMIT);
auth.openapiWithRateLimit(authChallengeRoute, authChallengeHandler, AUTH_RATE_LIMIT);
auth.openapiWithRateLimit(authLogoutRoute, authLogoutHandler, AUTH_RATE_LIMIT);
auth.openapiWithRateLimit(authRefreshRoute, authRefreshHandler, REFRESH_RATE_LIMIT);

// Magic-link routes
auth.openapiWithRateLimit(magicLinkRequestRoute, magicLinkRequestHandler, MAGIC_LINK_REQUEST_RATE_LIMIT);
auth.openapiWithRateLimit(magicLinkConsumeRoute, magicLinkConsumeHandler, MAGIC_LINK_CONSUME_RATE_LIMIT);

// Registration routes with stricter rate limiting
auth.openapiWithRateLimit(registerValidateRoute, registerValidateHandler, REGISTER_RATE_LIMIT);
auth.openapiWithRateLimit(registerRoute, registerHandler, REGISTER_RATE_LIMIT);
auth.openapiWithRateLimit(registerPasskeyVerifyRoute, registerPasskeyVerifyHandler, PASSKEY_RATE_LIMIT);

// Passkey login routes
auth.openapiWithRateLimit(passkeyLoginBeginRoute, passkeyLoginBeginHandler, PASSKEY_RATE_LIMIT);
auth.openapiWithRateLimit(passkeyLoginVerifyRoute, passkeyLoginVerifyHandler, PASSKEY_RATE_LIMIT);

// =====================================
// Account Recovery Routes
// =====================================
const RECOVERY_RATE_LIMIT: RateLimitOptions = {
  max: 5,
  window: 60 * 1000, // 1 minute
  blockDuration: 30 * 60 * 1000, // 30 minutes
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.1,
  keyPrefix: "recovery",
};

auth.openapiWithRateLimit(recoveryBeginRoute, recoveryBeginHandler, RECOVERY_RATE_LIMIT);
auth.openapiWithRateLimit(recoveryVerifyPhraseRoute, recoveryVerifyPhraseHandler, RECOVERY_RATE_LIMIT);
auth.openapiWithRateLimit(recoveryResetPasswordRoute, recoveryResetPasswordHandler, RECOVERY_RATE_LIMIT);
auth.openapiWithRateLimit(recoveryDisable2FARoute, recoveryDisable2FAHandler, RECOVERY_RATE_LIMIT);
auth.openapiWithRateLimit(recoveryVerifyBackupCodeRoute, recoveryVerifyBackupCodeHandler, RECOVERY_RATE_LIMIT);
auth.openapiWithRateLimit(recoverySendResetEmailRoute, recoverySendResetEmailHandler, RECOVERY_RATE_LIMIT);
auth.openapiWithRateLimit(recoveryVerifyEmailTokenRoute, recoveryVerifyEmailTokenHandler, RECOVERY_RATE_LIMIT);

export default auth;
