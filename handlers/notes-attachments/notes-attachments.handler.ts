/**
 * @file handlers/notes-attachments/notes-attachments.handler.ts
 * @description Note attachment handlers (mirrors routes/notes-attachments/notes-attachments.route.ts).
 *
 * getNoteAttachmentContentHandler is a download/stream handler — no responseSchema
 * (streams decrypted bytes back as a Response body).
 */

import { RouteHandler } from "@deps";
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import {
  SchemaNoteAttachmentApiResponse,
  SchemaNoteAttachmentListResponse,
  SchemaNoteAttachmentStatsResponse,
} from "@models/notes/note-attachment.model.ts";
import { getNoteAttachmentService } from "@services/notes-attachments/index.ts";
import { DataAccessService, encryptionModeFromKeyType } from "@services/encryption/index.ts";
import {
  deleteNoteAttachmentRoute,
  getNoteAttachmentContentRoute,
  getNoteAttachmentStatsRoute,
  listAllNoteAttachmentsRoute,
  listNoteAttachmentsForNoteRoute,
  uploadNoteAttachmentMultipartRoute,
  uploadNoteAttachmentRoute,
} from "@routes/notes-attachments/notes-attachments.route.ts";

const baseMeta = {
  entityType: "note_attachment" as const,
  loggerSection: loggerAppSections.NOTES,
};

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const uploadNoteAttachmentHandler = defineHandler(
  {
    route: uploadNoteAttachmentRoute,
    operationName: "note_attachment_upload",
    responseSchema: SchemaNoteAttachmentApiResponse,
    ...baseMeta,
  },
  async (ctx) => {
    const bytes = decodeBase64(ctx.body.bytesBase64);
    // The resolved data master key wraps the per-attachment master key
    // and (downstream) feeds the AES-GCM bytes-encryption path inside the
    // service.
    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(ctx.c);
    return {
      data: await getNoteAttachmentService().upload(
        {
          noteId: ctx.body.noteId,
          mimeType: ctx.body.mimeType,
          originalName: ctx.body.originalName,
          bytes,
        },
        ctx.userId,
        keyDetails.key,
        encryptionModeFromKeyType(keyDetails.type),
      ),
      status: 201,
    };
  },
);

export const uploadNoteAttachmentMultipartHandler = defineHandler(
  {
    route: uploadNoteAttachmentMultipartRoute,
    operationName: "note_attachment_upload_multipart",
    validationMode: "soft",
    ...baseMeta,
  },
  async (ctx) => {
    const form = await ctx.c.req.parseBody();
    const file = form["file"];
    const noteId = typeof form["noteId"] === "string" ? form["noteId"] : "";
    if (!noteId) throwHttpError("COMMON.BAD_REQUEST");
    if (!(file instanceof File)) throwHttpError("COMMON.BAD_REQUEST");
    const f = file as File;
    const mime = f.type || (typeof form["mimeType"] === "string" ? form["mimeType"] : "");
    const originalName = f.name ||
      (typeof form["originalName"] === "string" ? form["originalName"] : "upload");
    const buf = new Uint8Array(await f.arrayBuffer());
    // The resolved data master key wraps the per-attachment master key and
    // (downstream) feeds the AES-GCM bytes-encryption path inside the service.
    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(ctx.c);
    const att = await getNoteAttachmentService().upload(
      { noteId, mimeType: mime, originalName, bytes: buf },
      ctx.userId,
      keyDetails.key,
      encryptionModeFromKeyType(keyDetails.type),
    );
    return {
      data: {
        ...SchemaNoteAttachmentApiResponse.parse(att),
        url: `/api/notes-attachments/${att.id}/content`,
      },
      status: 201,
    };
  },
);

export const listAllNoteAttachmentsHandler = defineHandler(
  {
    route: listAllNoteAttachmentsRoute,
    operationName: "note_attachment_list_all",
    responseSchema: SchemaNoteAttachmentListResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: { items: await getNoteAttachmentService().listAllForOwner(ctx.userId) },
    status: 200,
  }),
);

export const getNoteAttachmentStatsHandler = defineHandler(
  {
    route: getNoteAttachmentStatsRoute,
    operationName: "note_attachment_stats",
    responseSchema: SchemaNoteAttachmentStatsResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: await getNoteAttachmentService().statsForOwner(ctx.userId),
    status: 200,
  }),
);

export const listNoteAttachmentsForNoteHandler = defineHandler(
  {
    route: listNoteAttachmentsForNoteRoute,
    operationName: "note_attachment_list",
    responseSchema: SchemaNoteAttachmentListResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: { items: await getNoteAttachmentService().listForNote(ctx.params.noteId, ctx.userId) },
    status: 200,
  }),
);

export const deleteNoteAttachmentHandler = defineHandler(
  { route: deleteNoteAttachmentRoute, operationName: "note_attachment_delete", ...baseMeta },
  async (ctx) => {
    await getNoteAttachmentService().delete(ctx.params.id, ctx.userId);
    return { data: null, status: 204 };
  },
);

export const getNoteAttachmentContentHandler: RouteHandler<typeof getNoteAttachmentContentRoute> = async (c) => {
  const { userId } = getAuthContext(c);
  const { id } = c.req.valid("param");
  // Resolve the caller's data master key so the service can unwrap the
  // per-attachment master key and decrypt the storage object before
  // streaming plaintext back to the client.
  const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(c);
  const result = await getNoteAttachmentService().streamContent(id, userId, keyDetails.key);
  if (!result) throwHttpError("COMMON.NOT_FOUND");
  const headers: Record<string, string> = {
    "content-type": result.attachment.mimeType,
    "content-disposition": `attachment; filename="${result.attachment.originalName.replaceAll('"', "")}"`,
  };
  if (result.contentLength !== undefined) {
    headers["content-length"] = String(result.contentLength);
  }
  return new Response(result.stream, { status: 200, headers });
};
