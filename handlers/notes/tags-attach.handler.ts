/**
 * @file handlers/notes/tags-attach.handler.ts
 * @description Tags Attach request handler
 */
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaNoteTagsForNoteResponse } from "@models/notes/note-tag.model.ts";
import { getNoteTagService } from "@services/notes-tags/singletons.ts";
import { attachNoteTagRoute, detachNoteTagRoute, listNoteTagsForNoteRoute } from "@routes/notes/tags-attach.route.ts";

const baseMeta = {
  entityType: "note_tag" as const,
  loggerSection: loggerAppSections.NOTES,
};

export const listNoteTagsForNoteHandler = defineHandler(
  {
    route: listNoteTagsForNoteRoute,
    operationName: "note_tag_list_for_note",
    responseSchema: SchemaNoteTagsForNoteResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: { items: await getNoteTagService().listForNote(ctx.params.id, ctx.userId) },
    status: 200,
  }),
);

export const attachNoteTagHandler = defineHandler(
  { route: attachNoteTagRoute, operationName: "note_tag_attach", ...baseMeta },
  async (ctx) => {
    await getNoteTagService().attachToNote(ctx.params.id, ctx.params.tagId, ctx.userId);
    return { data: null, status: 204 };
  },
);

export const detachNoteTagHandler = defineHandler(
  { route: detachNoteTagRoute, operationName: "note_tag_detach", ...baseMeta },
  async (ctx) => {
    await getNoteTagService().detachFromNote(ctx.params.id, ctx.params.tagId, ctx.userId);
    return { data: null, status: 204 };
  },
);
