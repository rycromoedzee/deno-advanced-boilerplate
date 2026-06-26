/**
 * @file routes/user/index.ts
 * @description User-related routes
 */

import { createRateLimitedApp, type RateLimitOptions } from "@utils/openapi/openapi-wrapper.ts";
import { getCurrentUserRoute } from "./get-current-user.route.ts";
import { getCurrentUserProfileConfigRoute } from "./get-current-user-profile-config.route.ts";
import { getCurrentUserHandler, getCurrentUserProfileConfigHandler } from "@handlers/user/index.ts";
import {
  batchUpdateUserPreferencesRoute,
  getUserPreferencesGroupedRoute,
  resetUserPreferenceRoute,
  updateUserPreferenceRoute,
} from "./notification-preferences.route.ts";
import {
  batchUpdateUserPreferencesHandler,
  getUserPreferencesGroupedHandler,
  resetUserPreferenceHandler,
  updateUserPreferenceHandler,
} from "@handlers/user/index.ts";
import {
  addPasskeyBeginRoute,
  addPasskeyVerifyRoute,
  deletePasskeyRoute,
  listPasskeysRoute,
  passkeyPrfSetupBeginRoute,
  passkeyPrfSetupVerifyRoute,
  reauthPasskeyBeginRoute,
  reauthPasskeyVerifyRoute,
  reauthPasswordRoute,
} from "./passkey.route.ts";
import { changePasswordRoute, setPasswordRoute } from "./password.route.ts";
import {
  addPasskeyBeginHandler,
  addPasskeyVerifyHandler,
  changePasswordHandler,
  deletePasskeyHandler,
  listPasskeysHandler,
  passkeyPrfSetupBeginHandler,
  passkeyPrfSetupVerifyHandler,
  reauthPasskeyBeginHandler,
  reauthPasskeyVerifyHandler,
  reauthPasswordHandler,
  setPasswordHandler,
} from "@handlers/user/index.ts";
// Two-Factor Management Routes
import {
  createTwoFactorRoute,
  deleteTwoFactorRoute,
  getTwoFactorStatusRoute,
  listTwoFactorRoute,
  regenerateBackupCodesRoute,
  revealTwoFactorRoute,
} from "./two-factor.route.ts";
import {
  createTwoFactorHandler,
  deleteTwoFactorHandler,
  getTwoFactorStatusHandler,
  listTwoFactorHandler,
  regenerateBackupCodesHandler,
  revealTwoFactorHandler,
} from "@handlers/user/index.ts";
// Recovery Phrase Management Routes
import {
  createRecoveryPhraseRoute,
  deleteRecoveryPhraseRoute,
  getRecoveryPhraseStatusRoute,
  resetRecoveryPhraseRoute,
  verifyRecoveryPhraseRoute,
} from "./recovery-phrase.route.ts";
import {
  createRecoveryPhraseHandler,
  deleteRecoveryPhraseHandler,
  getRecoveryPhraseStatusHandler,
  resetRecoveryPhraseHandler,
  verifyRecoveryPhraseHandler,
} from "@handlers/user/index.ts";
import apiKeyApp from "./api-key/index.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";

const app = createRateLimitedApp();

const PASSKEY_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  window: 60 * 1000,
  blockDuration: 5 * 60 * 1000,
  keyPrefix: "passkey",
  keyGenerator: (c) => {
    const userId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails);
    return userId ? `user:${userId}` : `anon:${c.req.path}`;
  },
};

const REAUTH_RATE_LIMIT: RateLimitOptions = {
  max: 20,
  window: 15 * 60 * 1000,
  blockDuration: 30 * 60 * 1000,
  keyPrefix: "passkey_reauth",
  keyGenerator: (c) => {
    const userId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails);
    return userId ? `user:${userId}` : `anon:${c.req.path}`;
  },
};

// Get current user route
app.openapi(getCurrentUserRoute, getCurrentUserHandler);
app.openapi(getCurrentUserProfileConfigRoute, getCurrentUserProfileConfigHandler);

// =====================================
// User Notification Preferences
// =====================================

app.openapi(getUserPreferencesGroupedRoute, getUserPreferencesGroupedHandler);
app.openapi(batchUpdateUserPreferencesRoute, batchUpdateUserPreferencesHandler);
app.openapi(updateUserPreferenceRoute, updateUserPreferenceHandler);
app.openapi(resetUserPreferenceRoute, resetUserPreferenceHandler);

// =====================================
// Passkey Management (rate limited)
// =====================================
app.openapiWithRateLimit(listPasskeysRoute, listPasskeysHandler, PASSKEY_RATE_LIMIT);
app.openapiWithRateLimit(addPasskeyBeginRoute, addPasskeyBeginHandler, PASSKEY_RATE_LIMIT);
app.openapiWithRateLimit(addPasskeyVerifyRoute, addPasskeyVerifyHandler, PASSKEY_RATE_LIMIT);
app.openapiWithRateLimit(reauthPasswordRoute, reauthPasswordHandler, REAUTH_RATE_LIMIT);
app.openapiWithRateLimit(reauthPasskeyBeginRoute, reauthPasskeyBeginHandler, REAUTH_RATE_LIMIT);
app.openapiWithRateLimit(reauthPasskeyVerifyRoute, reauthPasskeyVerifyHandler, REAUTH_RATE_LIMIT);
app.openapiWithRateLimit(deletePasskeyRoute, deletePasskeyHandler, PASSKEY_RATE_LIMIT);
app.openapiWithRateLimit(passkeyPrfSetupBeginRoute, passkeyPrfSetupBeginHandler, PASSKEY_RATE_LIMIT);
app.openapiWithRateLimit(passkeyPrfSetupVerifyRoute, passkeyPrfSetupVerifyHandler, PASSKEY_RATE_LIMIT);

// =====================================
// Password Management (rate limited)
// =====================================
app.openapiWithRateLimit(setPasswordRoute, setPasswordHandler, REAUTH_RATE_LIMIT);
app.openapiWithRateLimit(changePasswordRoute, changePasswordHandler, REAUTH_RATE_LIMIT);

// =====================================
// Two-Factor Authentication Management
// =====================================
const TWO_FACTOR_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  window: 60 * 1000,
  blockDuration: 5 * 60 * 1000,
  keyPrefix: "two_factor",
  keyGenerator: (c) => {
    const userId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails);
    return userId ? `user:${userId}` : `anon:${c.req.path}`;
  },
};

app.openapiWithRateLimit(listTwoFactorRoute, listTwoFactorHandler, TWO_FACTOR_RATE_LIMIT);
app.openapiWithRateLimit(createTwoFactorRoute, createTwoFactorHandler, TWO_FACTOR_RATE_LIMIT);
app.openapiWithRateLimit(deleteTwoFactorRoute, deleteTwoFactorHandler, TWO_FACTOR_RATE_LIMIT);
app.openapiWithRateLimit(regenerateBackupCodesRoute, regenerateBackupCodesHandler, TWO_FACTOR_RATE_LIMIT);
app.openapiWithRateLimit(getTwoFactorStatusRoute, getTwoFactorStatusHandler, TWO_FACTOR_RATE_LIMIT);
app.openapiWithRateLimit(revealTwoFactorRoute, revealTwoFactorHandler, TWO_FACTOR_RATE_LIMIT);

// =====================================
// Recovery Phrase Management
// =====================================
const RECOVERY_PHRASE_RATE_LIMIT: RateLimitOptions = {
  max: 5,
  window: 60 * 1000,
  blockDuration: 15 * 60 * 1000,
  keyPrefix: "recovery_phrase",
  keyGenerator: (c) => {
    const userId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails);
    return userId ? `user:${userId}` : `anon:${c.req.path}`;
  },
};

app.openapiWithRateLimit(getRecoveryPhraseStatusRoute, getRecoveryPhraseStatusHandler, RECOVERY_PHRASE_RATE_LIMIT);
app.openapiWithRateLimit(createRecoveryPhraseRoute, createRecoveryPhraseHandler, RECOVERY_PHRASE_RATE_LIMIT);
app.openapiWithRateLimit(verifyRecoveryPhraseRoute, verifyRecoveryPhraseHandler, RECOVERY_PHRASE_RATE_LIMIT);
app.openapiWithRateLimit(resetRecoveryPhraseRoute, resetRecoveryPhraseHandler, RECOVERY_PHRASE_RATE_LIMIT);
app.openapiWithRateLimit(deleteRecoveryPhraseRoute, deleteRecoveryPhraseHandler, RECOVERY_PHRASE_RATE_LIMIT);

// =====================================
// API Key Management (self-service)
// =====================================
app.route("/api-key", apiKeyApp);

export default app;
