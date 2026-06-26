/**
 * @file handlers/notes-collections/notes-collections.handler.ts
 * @description Notes Collections request handler
 */
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaNoteCollectionApiResponse, SchemaNoteCollectionListResponse } from "@models/notes/note-collection.model.ts";
import {
  getCollectionArchiveService,
  getCollectionCreateService,
  getCollectionDeleteService,
  getCollectionReadService,
  getCollectionUpdateService,
} from "@services/notes-collections/singletons.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import {
  archiveCollectionRoute,
  createCollectionRoute,
  deleteCollectionRoute,
  getCollectionRoute,
  listCollectionsRoute,
  restoreCollectionRoute,
  updateCollectionRoute,
} from "@routes/notes-collections/notes-collections.route.ts";

const baseMeta = {
  entityType: "note_collection" as const,
  loggerSection: loggerAppSections.NOTES,
};

export const listCollectionsHandler = defineHandler(
  {
    route: listCollectionsRoute,
    operationName: "note_collection_list",
    responseSchema: SchemaNoteCollectionListResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getCollectionReadService().list(
      { archived: ctx.query.archived },
      ctx.userId,
      ctx.environmentId,
    ),
    status: 200,
  }),
);

export const createCollectionHandler = defineHandler(
  {
    route: createCollectionRoute,
    operationName: "note_collection_create",
    responseSchema: SchemaNoteCollectionApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getCollectionCreateService().create(ctx.body, ctx.userId, ctx.environmentId),
    status: 201,
  }),
);

export const getCollectionHandler = defineHandler(
  {
    route: getCollectionRoute,
    operationName: "note_collection_get",
    responseSchema: SchemaNoteCollectionApiResponse,
    ...baseMeta,
  },
  async (ctx) => {
    const row = await getCollectionReadService().findById(
      ctx.params.id,
      ctx.userId,
      ctx.environmentId,
    );
    if (!row) throwHttpError("COMMON.NOT_FOUND");
    return { data: row, status: 200 };
  },
);

export const updateCollectionHandler = defineHandler(
  {
    route: updateCollectionRoute,
    operationName: "note_collection_update",
    responseSchema: SchemaNoteCollectionApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getCollectionUpdateService().update(
      ctx.params.id,
      ctx.body,
      ctx.userId,
      ctx.environmentId,
    ),
    status: 200,
  }),
);

export const archiveCollectionHandler = defineHandler(
  {
    route: archiveCollectionRoute,
    operationName: "note_collection_archive",
    responseSchema: SchemaNoteCollectionApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getCollectionArchiveService().archive(
      ctx.params.id,
      ctx.userId,
      ctx.environmentId,
    ),
    status: 200,
  }),
);

export const restoreCollectionHandler = defineHandler(
  {
    route: restoreCollectionRoute,
    operationName: "note_collection_restore",
    responseSchema: SchemaNoteCollectionApiResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getCollectionArchiveService().restore(
      ctx.params.id,
      ctx.userId,
      ctx.environmentId,
    ),
    status: 200,
  }),
);

export const deleteCollectionHandler = defineHandler(
  { route: deleteCollectionRoute, operationName: "note_collection_delete", ...baseMeta },
  async (ctx) => {
    await getCollectionDeleteService().delete(ctx.params.id, ctx.userId, ctx.environmentId);
    return { data: null, status: 204 };
  },
);
