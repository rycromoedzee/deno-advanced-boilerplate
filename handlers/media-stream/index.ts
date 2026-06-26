/**
 * @file handlers/media-stream/index.ts
 * @description Barrel for media-stream handlers (mirrors routes/media-stream/).
 *
 * Route ↔ handler mirror:
 *   info.handler.ts    ↔ info.route.ts    (media file metadata)
 *   stream.handler.ts  ↔ stream.route.ts  (range request GET/HEAD stream — no responseSchema)
 */

export { mediaInfoHandler } from "./info.handler.ts";
export { mediaStreamHandler, mediaStreamHeadHandler } from "./stream.handler.ts";
