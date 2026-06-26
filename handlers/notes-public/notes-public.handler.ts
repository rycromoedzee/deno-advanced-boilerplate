/**
 * @file handlers/notes-public/notes-public.handler.ts
 * @description Notes Public request handler
 */
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getNotePublicShareService } from "@services/notes-sharing/singletons.ts";
import { accessPublicNoteRoute, SchemaPublicNoteResponse } from "@routes/notes-public/notes-public.route.ts";
import { requestContext } from "@db/index.ts";
import { parseShareId } from "@services/public-sharing/secure-link-generator.service.ts";

export const accessPublicNoteHandler = defineHandler(
  {
    route: accessPublicNoteRoute,
    operationName: "note_public_access",
    entityType: "note",
    loggerSection: loggerAppSections.NOTES,
    responseSchema: SchemaPublicNoteResponse,
    errorKey: "NOTE.INTERNAL_SERVER_ERROR",
    authContext: false,
  },
  async (ctx) => {
    // The shareId encodes the environmentId for tenant DB routing. The public
    // route runs without auth context, so inject the envId into requestContext
    // before delegating to the service (mirrors the public documents handler).
    const { environmentId } = parseShareId(ctx.query.shareId);
    if (!environmentId) {
      throw new Error("Invalid shareId: missing environmentId");
    }

    return await requestContext.run(
      { environmentId, userId: "" },
      async () => ({
        data: await getNotePublicShareService().accessPublicShareBody(
          ctx.query.shareId,
          ctx.query.shareKey,
          ctx.query.password ?? undefined,
          {
            ipAddress: ctx.c.req.header("x-forwarded-for") ?? undefined,
            userAgent: ctx.c.req.header("user-agent") ?? undefined,
          },
        ),
        status: 200 as const,
      }),
    );
  },
);
