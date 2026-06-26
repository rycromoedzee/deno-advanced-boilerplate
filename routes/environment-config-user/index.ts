/**
 * @file routes/environment-config-user/index.ts
 * @description Barrel/Hono app wiring for environment config user routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";

// Import user routes
import { createUserRoute, deleteUserRoute, getUserRoute, listUsersRoute, updateUserRoute } from "./environment-config-user.route.ts";

// Import handlers
import {
  createUserHandler,
  deleteUserHandler,
  getUserHandler,
  listUsersHandler,
  updateUserHandler,
} from "@handlers/environment-config-user/index.ts";

// Rate limit configurations
const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

// Create the environment config user app
const environmentConfigUser = createRateLimitedApp();

// =====================================
// User routes
// =====================================

// List users
environmentConfigUser.openapiWithRateLimit(
  listUsersRoute,
  listUsersHandler,
  STANDARD_RATE_LIMIT,
);

// Create user
environmentConfigUser.openapiWithRateLimit(
  createUserRoute,
  createUserHandler,
  STANDARD_RATE_LIMIT,
);

// Get user
environmentConfigUser.openapiWithRateLimit(
  getUserRoute,
  getUserHandler,
  STANDARD_RATE_LIMIT,
);

// Update user
environmentConfigUser.openapiWithRateLimit(
  updateUserRoute,
  updateUserHandler,
  STANDARD_RATE_LIMIT,
);

// Delete user
environmentConfigUser.openapiWithRateLimit(
  deleteUserRoute,
  deleteUserHandler,
  STANDARD_RATE_LIMIT,
);

// Export main router
export default environmentConfigUser;
