/**
 * @file models/auth/passwords.model.ts
 * @description Passwords model/types
 */
import { z } from "@deps";
import { withKey } from "@utils/validation/zod-message-key.ts";

/**
 * Password validation schema
 * Validates password requirements: min 10 chars, max 128 chars,
 * must contain uppercase, lowercase, number, and special character
 */
export const SCHEMA_VALIDATION_PASSWORD = z.string()
  .min(10, withKey("auth-password.min-length", "Password is too short"))
  .max(128, withKey("auth-password.max-length", "Password is too long"))
  .refine((password) => /[A-Z]/.test(password), {
    message: withKey("auth.password.error.uppercase", "Password must contain at least one uppercase letter"),
  })
  .refine((password) => /[a-z]/.test(password), {
    message: withKey("auth.password.error.lowercase", "Password must contain at least one lowercase letter"),
  })
  .refine((password) => /[0-9]/.test(password), {
    message: withKey("auth.password.error.number", "Password must contain at least one number"),
  })
  .refine((password) => /[\W_]/.test(password), {
    message: withKey("auth.password.error.special", "Password must contain at least one special character"),
  }).openapi({
    description: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
    example: "Password123!",
  });
