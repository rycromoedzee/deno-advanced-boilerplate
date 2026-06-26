/**
 * @file handlers/notes-public/index.ts
 * @description Barrel for public-note handlers (mirrors routes/notes-public/).
 *
 * Route ↔ handler mirror:
 *   notes-public.handler.ts ↔ notes-public.route.ts (public share access, no auth)
 */

export { accessPublicNoteHandler } from "./notes-public.handler.ts";
