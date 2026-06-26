/**
 * @file models/auth/token.model.ts
 * @description Response schemas for auth token operations
 */

import { z } from "@deps";

export const SchemaAuthRefreshResponse = z.object({
  message: z.string().openapi({
    description: "Success message for the token refresh",
    example: "Token refreshed successfully",
  }),
  expiresAt: z.number().openapi({
    description: "Unix timestamp (milliseconds) when the new access token expires",
    example: 1750896000000,
  }),
  refreshExpiresAt: z.number().openapi({
    description: "Unix timestamp (milliseconds) when the new refresh token expires",
    example: 1753488000000,
  }),
});

export type IAuthRefreshResponse = z.infer<typeof SchemaAuthRefreshResponse>;
