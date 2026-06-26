/**
 * @file services/notes-tags/tag-crud.helpers.ts
 * @description Helper functions for notes tags services
 */

// ---------- Types ----------

export interface INoteTag {
  id: string;
  ownerId: string;
  name: string;
  color: string | null;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface INoteTagCreate {
  name: string;
  color?: string | null;
}

export interface INoteTagUpdate {
  name?: string;
  color?: string | null;
}

export interface INoteTagListQuery {
  q?: string;
  page: number;
  limit: number;
  sortBy?: "name" | "usageCount" | "createdAt";
  sortOrder?: "asc" | "desc";
}
