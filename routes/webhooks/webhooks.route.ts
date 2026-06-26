/**
 * @file routes/webhooks/webhooks.route.ts
 * @description Webhooks route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

const EmailStatusResponseSchema = z.object({
  success: z.boolean().openapi({ example: true }),
  correlationId: z.string().openapi({
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
});

export const emailStatusRoute = createRoute({
  method: "post",
  path: "/email-status/{token}",
  tags: [OpenAPITags.webhooks],
  summary: "Receive email delivery status from provider",
  operationId: "webhookEmailStatusUpdate",
  security: [],
  description: `Inbound webhook receiver for email delivery status events (e.g. from Resend).

**Behavior:** Authenticates via the path token and Svix signature, enforces a sender IP allowlist and a 5-minute timestamp window, deduplicates by svix-id, then records the email status event. Always responds 200 with a correlation id (failures return success=false rather than an error code, to avoid provider retries).
**Auth:** public (webhook token in path + Svix signature verification)
**Permissions:** none beyond token/signature validation
**Notes:** No session/API-key auth; rejected requests surface as 404 to avoid leaking endpoint existence. Constant-time comparisons and minimum-processing-time guards mitigate timing attacks.`,
  request: {
    params: z.object({
      token: z.string().openapi({
        description: "Secure webhook token for authentication",
        example: "3b509b933d419cc832fc9e23f584df41fd3353727c42e1f6989be58dcb4bca84",
      }),
    }),
    body: {
      content: {},
    },
  },
  responses: {
    200: {
      description: "Webhook processed (success or failure)",
      content: {
        "application/json": {
          schema: EmailStatusResponseSchema,
        },
      },
    },
  },
});
