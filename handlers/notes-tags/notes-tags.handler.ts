/**
 * @file handlers/notes-tags/notes-tags.handler.ts
 * @description Notes Tags request handler
 */
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaNoteTagApiResponse, SchemaNoteTagListResponse } from "@models/notes/note-tag.model.ts";
import { getNoteTagService } from "@services/notes-tags/singletons.ts";
import {
  createNoteTagRoute,
  deleteNoteTagRoute,
  getNoteTagRoute,
  listNoteTagsRoute,
  updateNoteTagRoute,
} from "@routes/notes-tags/notes-tags.route.ts";
import { throwHttpError } from "@utils/http-exception.ts";

const baseMeta = {
  entityType: "note_tag" as const,
  loggerSection: loggerAppSections.NOTES,
};

export const listNoteTagsHandler = defineHandler(
  {
    route: listNoteTagsRoute,
    operationName: "note_tag_list",
    responseSchema: SchemaNoteTagListResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getNoteTagService().list(ctx.query, ctx.userId),
    status: 200,
  }),
);

export const createNoteTagHandler = defineHandler(
  {
    route: createNoteTagRoute,
    operationName: "note_tag_create",
    responseSchema: SchemaNoteTagApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getNoteTagService().create(ctx.body, ctx.userId),
    status: 201,
  }),
);

export const getNoteTagHandler = defineHandler(
  {
    route: getNoteTagRoute,
    operationName: "note_tag_get",
    responseSchema: SchemaNoteTagApiResponse,
    ...baseMeta,
  },
  async (ctx) => {
    const tag = await getNoteTagService().findById(ctx.params.id, ctx.userId);
    if (!tag) throwHttpError("COMMON.NOT_FOUND");
    return { data: tag, status: 200 };
  },
);

export const updateNoteTagHandler = defineHandler(
  {
    route: updateNoteTagRoute,
    operationName: "note_tag_update",
    responseSchema: SchemaNoteTagApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getNoteTagService().update(ctx.params.id, ctx.body, ctx.userId),
    status: 200,
  }),
);

export const deleteNoteTagHandler = defineHandler(
  { route: deleteNoteTagRoute, operationName: "note_tag_delete", ...baseMeta },
  async (ctx) => {
    await getNoteTagService().delete(ctx.params.id, ctx.userId);
    return { data: null, status: 204 };
  },
);
