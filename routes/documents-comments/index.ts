/**
 * @file routes/documents-comments/index.ts
 * @description Barrel/Hono app wiring for documents comments routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  createCommentHandler,
  deleteCommentHandler,
  getCommentHandler,
  listCommentsHandler,
  resolveCommentHandler,
  unresolveCommentHandler,
} from "@handlers/documents-comments/index.ts";
import {
  createCommentRoute,
  deleteCommentRoute,
  getCommentRoute,
  listCommentsRoute,
  resolveCommentRoute,
  unresolveCommentRoute,
} from "./documents-comments.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(createCommentRoute, createCommentHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(listCommentsRoute, listCommentsHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(getCommentRoute, getCommentHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(deleteCommentRoute, deleteCommentHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(resolveCommentRoute, resolveCommentHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(unresolveCommentRoute, unresolveCommentHandler, STANDARD_RATE_LIMIT);

export default app;
