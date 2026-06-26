/**
 * @file services/notes-permission/singletons.ts
 * @description Lazy singletons for notes permission services
 */
import { NotePermissionService } from "./note-permission.service.ts";

let instance: NotePermissionService | null = null;
export function getNotePermissionService(): NotePermissionService {
  if (!instance) instance = new NotePermissionService();
  return instance;
}
