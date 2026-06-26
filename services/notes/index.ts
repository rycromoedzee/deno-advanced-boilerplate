/**
 * @file services/notes/index.ts
 * @description Main export file for notes services
 */

// Service class exports
export { NoteCreateService } from "./note-create.service.ts";
export { NoteReadService } from "./note-read.service.ts";
export { NoteUpdateService } from "./note-update.service.ts";
export { NoteArchiveService } from "./note-archive.service.ts";
export { NoteDeleteService } from "./note-delete.service.ts";
export { NoteEventsSSEService } from "./note-events-sse.service.ts";
export { NoteEncryptionService } from "./note-encryption.service.ts";
export type { NoteEvent, NoteEventFilter } from "./note-events-sse.service.ts";

// Singleton getters
export {
  getNoteArchiveService,
  getNoteCreateService,
  getNoteDeleteService,
  getNoteEncryptionService,
  getNoteEventsSSEService,
  getNoteReadService,
  getNoteUpdateService,
} from "./singletons.ts";
