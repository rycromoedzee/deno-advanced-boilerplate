/**
 * @file handlers/debug/index.ts
 * @description Barrel for debug/dev-tooling handlers (mirrors routes/debug/).
 *
 * NOTE: these are dev/diagnostics endpoints (no auth, no environment), mounted under
 * routes/debug/. They are real mounted handlers (not test fixtures), so they get a barrel
 * like any other handler dir — but they are not user-facing production API surface.
 *
 * Route ↔ handler mirror:
 *   add-mail-to-queue.handler.ts ↔ add-mail-to-queue.route.ts (ad-hoc email-send probe)
 */

export { addMailToQueueHandler } from "./add-mail-to-queue.handler.ts";
