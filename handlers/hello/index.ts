/**
 * @file handlers/hello/index.ts
 * @description Barrel for the hello/sample handlers.
 *
 * Route ↔ handler mirror:
 *   hello.handler.ts ↔ routes/hello/hello.route.ts (sample greeting endpoint, no auth)
 */

export { helloHandler } from "./hello.handler.ts";
