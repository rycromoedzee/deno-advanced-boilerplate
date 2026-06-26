/**
 * @file services/notes-events/index.ts
 * @description Re-exports from services/notes — the SSE service lives there
 *              but this path is kept for backward compatibility.
 */

export { getNoteEventsSSEService } from "@services/notes/index.ts";
