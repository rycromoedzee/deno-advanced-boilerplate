/**
 * @file services/notes-attachments/singletons.ts
 * @description Lazy singletons for notes attachments services
 */
import { NoteAttachmentService } from "./note-attachment.service.ts";
import { NoteAttachmentPermissionService } from "./note-attachment-permission.service.ts";

let instance: NoteAttachmentService | null = null;
export function getNoteAttachmentService(): NoteAttachmentService {
  if (!instance) instance = new NoteAttachmentService();
  return instance;
}

let permissionInstance: NoteAttachmentPermissionService | null = null;
export function getNoteAttachmentPermissionService(): NoteAttachmentPermissionService {
  if (!permissionInstance) permissionInstance = new NoteAttachmentPermissionService();
  return permissionInstance;
}
