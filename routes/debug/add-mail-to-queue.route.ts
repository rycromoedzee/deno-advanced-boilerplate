/**
 * @file routes/debug/add-mail-to-queue.route.ts
 * @description Add Mail To Queue route definition
 */
import { createRoute, z } from "@deps";
import { withJsonBody } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
const SignUpDataSchema = z.object({}).strict();

const AddMailToQueueBaseSchema = z.object({
  userId: z.string().min(1).openapi({
    description: "User ID",
    example: "user123",
  }),
  to: z.string().email().openapi({
    description: "Recipient email address",
    example: "recipient@example.com",
  }),
  language: z.enum(["en", "fr"]).openapi({
    description: "Language code",
    example: "en",
  }),
});

const SignUpMailSchema = AddMailToQueueBaseSchema.extend({
  emailTemplateName: z.literal("sign-up").openapi({
    description: "Email template name",
    example: "sign-up",
  }),
  emailCategory: z.literal("AUTH").openapi({
    description: "Email category",
    example: "AUTH",
  }),
  data: SignUpDataSchema.openapi({
    description: "JSON data for email template",
    example: {},
  }),
}).strict();

export const AddMailToQueueQuerySchema = z.discriminatedUnion(
  "emailTemplateName",
  [
    SignUpMailSchema,
  ],
);

const AddMailToQueueResponseSchema = z.object({
  status: z.string().openapi({
    description: "Status",
    example: "success",
  }),
  message: z.string().openapi({
    description: "Message",
    example: "Email added to queue",
  }),
});

export const addMailToQueueRoute = createRoute({
  method: "post",
  path: "/add-mail-to-queue",
  tags: [OpenAPITags.debug],
  summary: "Add email to sending queue",
  operationId: "debugAddMailToQueue",
  description: `Queue an email for sending with the specified template and parameters.

**Behavior:** Validates the request body against the discriminated email-template schema, looks the template up in the registered \`EMAIL_TYPES\`, then enqueues the send via the email sender service. Returns 201 with a success envelope whose message echoes the sender result.
**Auth:** super-admin (production) / dev-only (development)
**Permissions:** none
**Notes:** Debug/introspection endpoint mounted at \`/api/debug\`. In development it is unguarded; in production the mount is protected by the super-admin middleware. Tenant context (\`userId\`) is taken from the request body, not the session. An unknown \`emailTemplateName\` is rejected with a schema-validation error.`,
  request: withJsonBody(AddMailToQueueQuerySchema),
  responses: {
    201: {
      description: "Email successfully added to queue",
      content: {
        "application/json": {
          schema: AddMailToQueueResponseSchema,
        },
      },
    },
    400: {
      description: "Bad request — body failed validation or template is unknown",
      content: {
        "application/json": {
          schema: {
            message: z.string().openapi({
              description: "Message",
              example: "Schema validation failed",
            }),
            messageKey: z.string().openapi({
              description: "Message key",
              example: "common.errors.schema-validation-failed",
            }),
          },
        },
      },
    },
    405: {
      description: "Method Not Allowed",
      content: {
        "application/json": {
          schema: {
            message: z.string().openapi({
              description: "Message",
              example: "Method Not Allowed",
            }),
            messageKey: z.string().openapi({
              description: "Message key",
              example: "common.errors.method-not-allowed",
            }),
          },
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: {
            message: z.string().openapi({
              description: "Message",
              example: "Internal Server Error",
            }),
            messageKey: z.string().openapi({
              description: "Message key",
              example: "common.errors.internal-server-error",
            }),
            cause: z.string().openapi({
              description: "Cause",
              example: "Error message",
            }),
          },
        },
      },
    },
  },
});
