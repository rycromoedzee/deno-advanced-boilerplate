/**
 * @file handlers/documents-public/list-public-folder-documents.handler.ts
 * @description Handler for listing documents in a publicly shared folder (no auth)
 *
 * Public (unauthenticated) access via a composite shareId (encodedEnvId.token).
 * The environmentId is parsed from the shareId and injected into requestContext so
 * the sharing service's getTenantDB() resolves the owning tenant. Mirrors the
 * notes-public and documents-public handlers.
 *
 * ZERO-KNOWLEDGE ARCHITECTURE:
 * - shareId: Query parameter (encodes environmentId + bare token; lookup key)
 * - shareKey: Header "Share-Key" (from URL fragment, never sent in the URL)
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { requestContext } from "@db/index.ts";
import { parseShareId } from "@services/public-sharing/secure-link-generator.service.ts";
import { getDocumentFolderSharingService } from "@services/documents-sharing/index.ts";
import { listPublicFolderDocumentsRoutePublic } from "@routes/documents-public/documents-public.route.ts";
import { SchemaPublicFolderDocumentsResponse } from "@models/documents/folder-sharing.model.ts";

/**
 * Handler for GET /api/public/documents/folders/documents?shareId=xxx
 * Header: Share-Key: <shareKey from URL fragment>
 * Lists documents in a publicly shared folder (no authentication required)
 */
export const listPublicFolderDocumentsHandler = defineHandler(
  {
    route: listPublicFolderDocumentsRoutePublic,
    operationName: "folder_list_public_documents",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaPublicFolderDocumentsResponse,
    errorKey: "DOCUMENT_FOLDER.LIST_PUBLIC_DOCUMENTS_FAILED",
    authContext: false,
  },
  async (ctx) => {
    const { shareId, password } = ctx.query;
    const shareKey = ctx.c.req.header("Share-Key") || "";

    // The shareId encodes the environmentId for tenant DB routing. The public
    // route runs without auth context, so parse + inject envId into requestContext
    // before delegating to the service (mirrors notes-public / documents-public).
    const { environmentId, token } = parseShareId(shareId);
    if (!environmentId) {
      // Anti-enumeration: return NOT_FOUND for missing/legacy shareIds.
      throwHttpError("DOCUMENT_FOLDER.PUBLIC_SHARE_NOT_FOUND");
    }

    const reqContext = IPLookupUtils.getRequestContext(ctx.c);

    return await requestContext.run(
      { environmentId, userId: "" },
      async () => {
        const result = await getDocumentFolderSharingService().listPublicFolderDocuments(
          token,
          shareKey,
          password ?? undefined,
          {
            ipAddress: reqContext.ip,
            userAgent: reqContext.userAgent,
            referer: reqContext.headers["referer"] || reqContext.headers["Referer"],
          },
        );

        return { data: result, status: 200 as const };
      },
    );
  },
);
