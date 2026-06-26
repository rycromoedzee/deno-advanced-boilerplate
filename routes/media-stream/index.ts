/**
 * @file routes/media-stream/index.ts
 * @description Media streaming routes with Hono OpenAPI
 */

import { OpenAPIHono } from "@deps";
import { mediaStreamHeadRoute, mediaStreamRoute } from "./stream.route.ts";
import { mediaInfoRoute } from "./info.route.ts";
import { mediaInfoHandler, mediaStreamHandler, mediaStreamHeadHandler } from "@handlers/media-stream/index.ts";
import { initializeSectionValidators } from "@services/media-stream/index.ts";

// Initialize section validators for media streaming
initializeSectionValidators();

const mediaStreamApp = new OpenAPIHono();

// Media streaming routes with OpenAPI documentation
// IMPORTANT: Register HEAD route BEFORE GET route to ensure HEAD requests are handled correctly
mediaStreamApp.openapi(mediaStreamHeadRoute, mediaStreamHeadHandler);
mediaStreamApp.openapi(mediaStreamRoute, mediaStreamHandler);
mediaStreamApp.openapi(mediaInfoRoute, mediaInfoHandler);

export default mediaStreamApp;
