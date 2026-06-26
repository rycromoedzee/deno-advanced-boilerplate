/**
 * @file handlers/notes/notes.handler.ts
 * @description Notes request handler
 */
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaNoteApiResponse, SchemaNoteDetailApiResponse, SchemaNoteListApiResponse } from "@models/notes/note.model.ts";
import {
  SchemaNoteVersionApiResponse,
  SchemaNoteVersionDetailApiResponse,
  SchemaNoteVersionListResponse,
} from "@models/notes/note-version.model.ts";
import { DataAccessService, encryptionModeFromKeyType } from "@services/encryption/index.ts";
import {
  getNoteArchiveService,
  getNoteCreateService,
  getNoteDeleteService,
  getNoteReadService,
  getNoteUpdateService,
} from "@services/notes/index.ts";
import { getVersionCreateService, getVersionListService, getVersionReadService } from "@services/notes-versions/singletons.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import {
  archiveNoteRoute,
  createNoteRoute,
  deleteNoteRoute,
  getNoteRoute,
  getNoteVersionRoute,
  listNotesRoute,
  listNoteVersionsRoute,
  putNoteBodyRoute,
  restoreNoteRoute,
  updateNoteRoute,
} from "@routes/notes/notes.route.ts";

const baseMeta = {
  entityType: "note" as const,
  loggerSection: loggerAppSections.NOTES,
};

const versionMeta = {
  entityType: "note_version" as const,
  loggerSection: loggerAppSections.NOTES,
};

export const listNotesHandler = defineHandler(
  {
    route: listNotesRoute,
    operationName: "note_list",
    responseSchema: SchemaNoteListApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getNoteReadService().list(ctx.query, ctx.userId, ctx.environmentId),
    status: 200,
  }),
);

export const createNoteHandler = defineHandler(
  {
    route: createNoteRoute,
    operationName: "note_create",
    responseSchema: SchemaNoteApiResponse,
    ...baseMeta,
  },
  async (ctx) => {
    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(ctx.c);
    const created = await getNoteCreateService().createNote(
      ctx.userId,
      ctx.environmentId,
      keyDetails.key,
      encryptionModeFromKeyType(keyDetails.type),
      ctx.body,
    );
    return { data: { ...created, ownerName: ctx.fullName }, status: 201 };
  },
);

export const getNoteHandler = defineHandler(
  {
    route: getNoteRoute,
    operationName: "note_get",
    responseSchema: SchemaNoteDetailApiResponse,
    ...baseMeta,
  },
  async (ctx) => {
    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(ctx.c);
    const row = await getNoteReadService().getDetailById(
      ctx.params.id,
      ctx.userId,
      ctx.environmentId,
      keyDetails.key,
    );
    if (!row) throwHttpError("COMMON.NOT_FOUND");
    return { data: row, status: 200 };
  },
);

export const updateNoteHandler = defineHandler(
  {
    route: updateNoteRoute,
    operationName: "note_update",
    responseSchema: SchemaNoteApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getNoteUpdateService().update(ctx.params.id, ctx.body, ctx.userId, ctx.environmentId),
    status: 200,
  }),
);

export const archiveNoteHandler = defineHandler(
  {
    route: archiveNoteRoute,
    operationName: "note_archive",
    responseSchema: SchemaNoteApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getNoteArchiveService().archive(ctx.params.id, ctx.userId, ctx.environmentId),
    status: 200,
  }),
);

export const restoreNoteHandler = defineHandler(
  {
    route: restoreNoteRoute,
    operationName: "note_restore",
    responseSchema: SchemaNoteApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getNoteArchiveService().restore(ctx.params.id, ctx.userId, ctx.environmentId),
    status: 200,
  }),
);

export const deleteNoteHandler = defineHandler(
  { route: deleteNoteRoute, operationName: "note_delete", ...baseMeta },
  async (ctx) => {
    await getNoteDeleteService().delete(ctx.params.id, ctx.userId, ctx.environmentId);
    return { data: null, status: 204 };
  },
);

export const putNoteBodyHandler = defineHandler(
  {
    route: putNoteBodyRoute,
    operationName: "note_body_put",
    responseSchema: SchemaNoteVersionApiResponse,
    ...versionMeta,
  },
  async (ctx) => {
    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(ctx.c);
    return {
      data: await getVersionCreateService().putBody(
        ctx.params.id,
        ctx.body,
        ctx.userId,
        ctx.environmentId,
        keyDetails.key,
      ),
      status: 200,
    };
  },
);

export const listNoteVersionsHandler = defineHandler(
  {
    route: listNoteVersionsRoute,
    operationName: "note_versions_list",
    responseSchema: SchemaNoteVersionListResponse,
    ...versionMeta,
  },
  async (ctx) => ({
    data: await getVersionListService().list(ctx.params.id, ctx.userId, ctx.environmentId),
    status: 200,
  }),
);

export const getNoteVersionHandler = defineHandler(
  {
    route: getNoteVersionRoute,
    operationName: "note_version_get",
    responseSchema: SchemaNoteVersionDetailApiResponse,
    ...versionMeta,
  },
  async (ctx) => {
    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(ctx.c);
    const v = await getVersionReadService().getDetail(
      ctx.params.id,
      ctx.params.versionId,
      ctx.userId,
      ctx.environmentId,
      keyDetails.key,
    );
    if (!v) throwHttpError("COMMON.NOT_FOUND");
    return { data: v, status: 200 };
  },
);
