/**
 * @file routes/jobs/index.ts
 * @description Background job API routes
 *
 * This module contains routes for:
 * - Triggering background jobs
 * - Getting job status
 * - Streaming job updates via SSE
 * - Canceling jobs
 * - Downloading job results
 */

import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";

// Routes
import { cancelTaskRoute, downloadTaskResultRoute, getTaskStatusRoute, streamTaskStatusRoute, triggerTaskRoute } from "./jobs.route.ts";

// Handlers
import {
  cancelTaskHandler,
  downloadTaskResultHandler,
  getTaskStatusHandler,
  streamTaskStatusHandler,
  triggerTaskHandler,
} from "@handlers/jobs/index.ts";

// Rate limit configuration
const READ_RATE_LIMIT = {
  max: 200,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const WRITE_RATE_LIMIT = {
  max: 50,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const STREAM_RATE_LIMIT = {
  max: 50,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const jobsApp = createRateLimitedApp();

// =====================================
// Job Trigger (Write)
// =====================================

jobsApp.openapiWithRateLimit(
  triggerTaskRoute,
  triggerTaskHandler,
  WRITE_RATE_LIMIT,
);

// =====================================
// Job Status (Read)
// =====================================

jobsApp.openapiWithRateLimit(
  getTaskStatusRoute,
  getTaskStatusHandler,
  READ_RATE_LIMIT,
);

// =====================================
// Job Stream (SSE)
// =====================================

jobsApp.openapiWithRateLimit(
  streamTaskStatusRoute,
  streamTaskStatusHandler,
  STREAM_RATE_LIMIT,
);

// =====================================
// Job Cancel (Write)
// =====================================

jobsApp.openapiWithRateLimit(
  cancelTaskRoute,
  cancelTaskHandler,
  WRITE_RATE_LIMIT,
);

// =====================================
// Job Download (Read)
// =====================================

jobsApp.openapiWithRateLimit(
  downloadTaskResultRoute,
  downloadTaskResultHandler,
  READ_RATE_LIMIT,
);

export default jobsApp;
