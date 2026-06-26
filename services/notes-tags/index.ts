/**
 * @file services/notes-tags/index.ts
 * @description Barrel exports for notes tags services
 */
// Types
export type { INoteTag, INoteTagCreate, INoteTagListQuery, INoteTagUpdate } from "./tag-crud.helpers.ts";

// Individual services
export { TagCreateService } from "./tag-create.service.ts";
export { getTagCreateService } from "./singletons.ts";
export { TagReadService } from "./tag-read.service.ts";
export { getTagReadService } from "./singletons.ts";
export { TagUpdateService } from "./tag-update.service.ts";
export { getTagUpdateService } from "./singletons.ts";
export { TagDeleteService } from "./tag-delete.service.ts";
export { getTagDeleteService } from "./singletons.ts";
export { TagAssignService } from "./tag-assign.service.ts";
export { getTagAssignService } from "./singletons.ts";

// Backward-compatible facade
export { NoteTagService } from "./singletons.ts";
export { getNoteTagService } from "./singletons.ts";
