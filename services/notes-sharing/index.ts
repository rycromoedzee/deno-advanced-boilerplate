/**
 * @file services/notes-sharing/index.ts
 * @description Barrel exports for notes sharing services
 */
export { NoteSharingService } from "./note-sharing.service.ts";
export type {
  INoteEmbeddedSharedUser,
  INoteInternalShareListItem,
  INoteSharedUser,
  INoteSharedUserWithProfile,
} from "./note-sharing.service.ts";

export { NotePublicShareService } from "./note-public-share.service.ts";
export type {
  AccessPublicShareBodyResult,
  AccessPublicShareResult,
  CreatePublicShareOptions,
  CreatePublicShareResult,
  INotePublicShareListItem,
} from "./note-public-share.service.ts";

export { getNotePublicShareService, getNoteSharingService } from "./singletons.ts";
