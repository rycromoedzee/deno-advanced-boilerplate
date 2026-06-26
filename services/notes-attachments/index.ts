/**
 * @file services/notes-attachments/index.ts
 * @description Barrel exports for notes attachments services
 */
export { NoteAttachmentService } from "./note-attachment.service.ts";
export type { INoteAttachment, IUploadInput } from "./note-attachment.service.ts";
export { getNoteAttachmentService } from "./singletons.ts";
