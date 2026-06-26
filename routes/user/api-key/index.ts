/**
 * @file routes/user/api-key/index.ts
 * @description User self-service API key management sub-app (create / extend / revoke).
 *   Mounted under /api/user/api-key by routes/user/index.ts. Authentication is
 *   inherited from the global /api/* middleware; these routes add a per-user rate
 *   limit like the other mutating user routes.
 */

import { createRateLimitedApp, type RateLimitOptions } from "@utils/openapi/openapi-wrapper.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { createApiKeyRoute } from "./create.route.ts";
import { userApiKeyExtendRoute } from "./extend.route.ts";
import { userApiKeyRevokeRoute } from "./revoke.route.ts";
import { createApiKeyHandler, extendHandler, userApiKeyRevokeHandler } from "@handlers/user/index.ts";

const app = createRateLimitedApp();

// API-key operations mutate security state; rate-limit per user like the other
// mutating user routes (passkey / two-factor / recovery-phrase).
const API_KEY_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  window: 60 * 1000,
  blockDuration: 5 * 60 * 1000,
  keyPrefix: "user_api_key",
  keyGenerator: (c) => {
    const userId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails);
    return userId ? `user:${userId}` : `anon:${c.req.path}`;
  },
};

app.openapiWithRateLimit(createApiKeyRoute, createApiKeyHandler, API_KEY_RATE_LIMIT);
app.openapiWithRateLimit(userApiKeyExtendRoute, extendHandler, API_KEY_RATE_LIMIT);
app.openapiWithRateLimit(userApiKeyRevokeRoute, userApiKeyRevokeHandler, API_KEY_RATE_LIMIT);

export default app;
