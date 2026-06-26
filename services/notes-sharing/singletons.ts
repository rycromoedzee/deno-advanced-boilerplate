/**
 * @file services/notes-sharing/singletons.ts
 * @description Lazy singletons for notes sharing services
 */
import { NoteSharingService } from "./note-sharing.service.ts";
import { NotePublicShareService } from "./note-public-share.service.ts";

let instance: NoteSharingService | null = null;
export function getNoteSharingService(): NoteSharingService {
  if (!instance) instance = new NoteSharingService();
  return instance;
}

let publicShareInstance: NotePublicShareService | null = null;
export function getNotePublicShareService(): NotePublicShareService {
  if (!publicShareInstance) publicShareInstance = new NotePublicShareService();
  return publicShareInstance;
}
