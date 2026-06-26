/**
 * @file models/users/password.model.ts
 * @description Response schemas for user password operations
 */

import { z } from "@deps";

export const SchemaPasswordSetResponse = z.object({
  success: z.literal(true).openapi({ description: "Confirmation that the password was set", example: true }),
});

export type IPasswordSetResponse = z.infer<typeof SchemaPasswordSetResponse>;
