/**
 * @file handlers/debug/add-mail-to-queue.handler.ts
 * @description Add Mail To Queue request handler
 */
import { z } from "@deps";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getEmailSenderService } from "@services/mailer/index.ts";
import { addMailToQueueRoute } from "@routes/debug/add-mail-to-queue.route.ts";
import { EMAIL_TYPES } from "@interfaces/email.ts";
import { throwHttpError } from "@utils/http-exception.ts";

const SchemaAddMailToQueueResponse = z.object({
  status: z.string(),
  message: z.string(),
});

/**
 * Handler for adding email to queue endpoint
 */
export const addMailToQueueHandler = defineHandler(
  {
    route: addMailToQueueRoute,
    operationName: "add_mail_to_queue",
    entityType: "email",
    loggerSection: loggerAppSections.DEBUG,
    authContext: false,
    responseSchema: SchemaAddMailToQueueResponse,
  },
  async ({ body }) => {
    const emailSenderService = getEmailSenderService();

    // templateName is a strict union (EmailTemplateName); validate the dynamic
    // request value against the registered EMAIL_TYPES set rather than blindly
    // casting — rejects unknown templates with a clear validation error.
    const template = EMAIL_TYPES.find((t) => t.name === body.emailTemplateName);
    if (!template) {
      throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
    }

    const res = await emailSenderService.useSendEmail(
      body.userId,
      body.to,
      body.data as unknown as JSON,
      template.name,
      body.language,
    );

    return {
      status: 201 as const,
      data: {
        status: "success",
        message: "Email added to queue. With data: " + JSON.stringify(res),
      },
    };
  },
);
