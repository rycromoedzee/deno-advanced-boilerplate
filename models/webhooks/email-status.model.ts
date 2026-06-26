/**
 * @file models/webhooks/email-status.model.ts
 * @description Zod response schema for email status webhook endpoint
 */

import { z } from "@deps";

/** Email status webhook response */
export const SchemaEmailStatusResponse = z.object({
  success: z.boolean().openapi({
    description: "Whether the webhook event was processed successfully",
    example: true,
  }),
  correlationId: z.string().openapi({
    description: "Correlation UUID generated for this webhook delivery",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
});
