/**
 * @file services/notes-tags/singletons.ts
 * @description Lazy singletons for notes tags services
 */
import { TagCreateService } from "./tag-create.service.ts";
import { TagReadService } from "./tag-read.service.ts";
import { TagUpdateService } from "./tag-update.service.ts";
import { TagDeleteService } from "./tag-delete.service.ts";
import { TagAssignService } from "./tag-assign.service.ts";

import type { INoteTag, INoteTagCreate, INoteTagListQuery, INoteTagUpdate } from "./tag-crud.helpers.ts";
import type { INoteTagListResponse } from "@models/notes/note-tag.model.ts";

// ---------- Individual service singletons ----------

let tagCreateService: TagCreateService;
export function getTagCreateService(): TagCreateService {
  if (!tagCreateService) tagCreateService = new TagCreateService();
  return tagCreateService;
}

let tagReadService: TagReadService;
export function getTagReadService(): TagReadService {
  if (!tagReadService) tagReadService = new TagReadService();
  return tagReadService;
}

let tagUpdateService: TagUpdateService;
export function getTagUpdateService(): TagUpdateService {
  if (!tagUpdateService) tagUpdateService = new TagUpdateService();
  return tagUpdateService;
}

let tagDeleteService: TagDeleteService;
export function getTagDeleteService(): TagDeleteService {
  if (!tagDeleteService) tagDeleteService = new TagDeleteService();
  return tagDeleteService;
}

let tagAssignService: TagAssignService;
export function getTagAssignService(): TagAssignService {
  if (!tagAssignService) tagAssignService = new TagAssignService();
  return tagAssignService;
}

// ---------- Backward-compatible facade ----------

/**
 * Facade that preserves the original `NoteTagService` API surface.
 * Delegates to the split CRUD services internally.
 */
class NoteTagService {
  private get create_() {
    return getTagCreateService();
  }
  private get read_() {
    return getTagReadService();
  }
  private get update_() {
    return getTagUpdateService();
  }
  private get delete_() {
    return getTagDeleteService();
  }
  private get assign_() {
    return getTagAssignService();
  }

  create(input: INoteTagCreate, userId: string): Promise<INoteTag> {
    return this.create_.create(input, userId);
  }

  findById(id: string, userId: string): Promise<INoteTag | null> {
    return this.read_.findById(id, userId);
  }

  update(id: string, patch: INoteTagUpdate, userId: string): Promise<INoteTag> {
    return this.update_.update(id, patch, userId);
  }

  delete(id: string, userId: string): Promise<void> {
    return this.delete_.delete(id, userId);
  }

  list(opts: INoteTagListQuery, userId: string): Promise<INoteTagListResponse> {
    return this.read_.list(opts, userId);
  }

  attachToNote(noteId: string, tagId: string, userId: string): Promise<void> {
    return this.assign_.attachToNote(noteId, tagId, userId);
  }

  detachFromNote(noteId: string, tagId: string, userId: string): Promise<void> {
    return this.assign_.detachFromNote(noteId, tagId, userId);
  }

  listForNote(noteId: string, userId: string): Promise<INoteTag[]> {
    return this.read_.listForNote(noteId, userId);
  }

  listForNotes(noteIds: string[], userId: string): Promise<Record<string, INoteTag[]>> {
    return this.read_.listForNotes(noteIds, userId);
  }
}

export { NoteTagService };

let instance: NoteTagService | null = null;
export function getNoteTagService(): NoteTagService {
  if (!instance) instance = new NoteTagService();
  return instance;
}
