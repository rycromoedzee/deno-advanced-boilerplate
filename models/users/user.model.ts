/**
 * @file models/users/user.model.ts
 * @description User model/types
 */
import { z } from "@deps";

/**
 * User ID validation schema
 */
export const SCHEMA_USER_ID = z.string()
  .nonempty()
  .openapi({
    description: "User ID",
    example: "8g7t305mlm7g7tm856",
  });
export type IUserId = z.infer<typeof SCHEMA_USER_ID>;
