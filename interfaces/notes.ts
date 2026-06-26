/**
 * @file interfaces/notes.ts
 * @description Notes-related interfaces shared across services and handlers.
 */

/** Minimal contract for emitting note SSE events. Implemented by the
 *  notes-events service; consumed by note services without a hard import
 *  to break what would otherwise be a circular dependency. */
export interface INoteEventEmitter {
  broadcast(
    event: INoteEvent,
    userId: string,
    environmentId: string,
  ): void;
}

export type INoteEvent =
  | { type: "note.created"; noteId: string }
  | { type: "note.updated"; noteId: string; updatedAt: number }
  | { type: "note.archived"; noteId: string }
  | { type: "note.restored"; noteId: string }
  | { type: "note.deleted"; noteId: string }
  | { type: "note.shared"; noteId: string; recipientUserId: string }
  | { type: "note.body.put"; noteId: string; versionId: string };
