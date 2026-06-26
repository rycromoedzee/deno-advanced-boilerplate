/**
 * @file routes/documents/thumbnail-upload.route.ts
 * @description Route for uploading document thumbnails from frontend
 */

import { createRoute, z } from "@deps";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { SCHEMA_DOCUMENT_ID } from "@models/documents/index.ts";

/**
 * POST /api/documents/:id/thumbnail
 * Upload a thumbnail image for a document
 */
export const uploadDocumentThumbnailRoute = createRoute({
  method: "post",
  path: "/{id}/thumbnail",
  operationId: "documentThumbnailUpload",
  summary: "Upload document thumbnail",
  description: `Upload a thumbnail image generated on the frontend for an existing document.

**Behavior:** Accepts a JPEG thumbnail (max 1 MB), validates the image dimensions, encrypts the bytes with a per-thumbnail data key, stores the encrypted thumbnail, and propagates the wrapped thumbnail key to the owner's row plus every shared user's \`documentsDataKeys\` row (APP_CONTROLLED users get the same wrapped key; ASYMMETRIC users get an ECIES-wrapped key). Updates the document's storage metadata with the thumbnail path and dimensions.
**Auth:** cookie session or API key.
**Permissions:** the caller must have ADMIN (owner) access on the document; 403 otherwise, 404 if the document is not found or is archived.
**Notes:** tenant-scoped; JPEG only; max 1 MB. The thumbnail is served (decrypted) via GET \`/{id}/preview\`.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
    body: {
      content: {
        "image/jpeg": {
          schema: z.instanceof(Blob).openapi({
            type: "string",
            format: "binary",
            description: "Thumbnail image in JPEG format",
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Thumbnail uploaded successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().openapi({
              example: true,
            }),
            thumbnailUrl: z.string().openapi({
              example: "/api/documents/doc_123/preview",
            }),
            thumbnailSize: z.number().int().openapi({
              example: 45678,
            }),
            thumbnailWidth: z.number().int().openapi({
              example: 600,
            }),
            thumbnailHeight: z.number().int().openapi({
              example: 400,
            }),
          }),
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseForbidden,
    ...httpResponseInternalServerError,
  },
});
