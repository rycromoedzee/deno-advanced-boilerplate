/**
 * @file services/notes/note-events-sse.service.ts
 * @description SSE service for real-time note mutation events.
 *
 * Combines what Plan C originally split into "event bus" + "SSE service":
 * BaseSSEService.broadcast() IS the bus (Pub/Sub-backed), and connections
 * subscribe through registerConnection. Any caller that wants to emit
 * a note event imports getNoteEventsSSEService().broadcast(...).
 *
 * Permission: only deliver to the recipient userId. Cross-user isolation
 * is enforced by the broadcast(userId, environmentId) tuple — a
 * connection only receives events whose userId matches its own.
 */

import type { SSEConnection, SSEEvent } from "@services/shared/sse.types.ts";
import { BaseSSEService } from "@services/shared/base-sse.service.ts";
import type { INoteEvent, INoteEventEmitter } from "@interfaces/notes.ts";

export type NoteEvent = INoteEvent;

export type NoteEventFilter = {
  // Optional: limit to a specific noteId (e.g. an editor pinned to one note).
  noteId?: string;
};

export class NoteEventsSSEService extends BaseSSEService<NoteEvent, NoteEventFilter> implements INoteEventEmitter {
  constructor() {
    super("noteEvents", "note-events");
  }

  protected matchesFilters(event: NoteEvent, filters: NoteEventFilter): boolean {
    if (filters.noteId && event.noteId !== filters.noteId) return false;
    return true;
  }

  /**
   * Cross-user isolation: BaseSSEService only checks environmentId by
   * default; we additionally pin delivery to the broadcast's userId so
   * note events emitted to user A are not visible to user B in the same
   * tenant.
   */
  protected override shouldDeliverToConnection(
    data: NoteEvent,
    connection: SSEConnection<NoteEventFilter>,
    event: SSEEvent<NoteEvent>,
  ): boolean {
    if (connection.userId !== event.userId) return false;
    return super.shouldDeliverToConnection(data, connection, event);
  }

  /**
   * Recipient is already pinned by (userId, environmentId) in broadcast().
   * No further resource-level permission check required — emitters only
   * publish to users who legitimately have access (owner, sharee, etc.).
   */
  protected override async checkPermission(
    _data: NoteEvent,
    _connection: SSEConnection<NoteEventFilter>,
  ): Promise<boolean> {
    return await Promise.resolve(true);
  }
}
