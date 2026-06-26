/**
 * @file constants/token.ts
 * @description Auth token-related constants (headers, cookies, config keys)
 */
import { envConfig } from "@config/env.ts";

export enum JWT_TOKEN_TYPES {
  "AUTH",
  "EMAIL",
  "MAGIC",
  "VERIFY",
  "RESET",
  "MULTI_USER",
  "TWO_FACTOR",
}

export const JWT_TOKEN_CONFIG = {
  issuer: envConfig.public.backURL,

  audiences: {
    email: `${envConfig.public.backURL}/api/email`, // Email unsubscribe tokens
    magic: `${envConfig.public.backURL}/api/auth/magic`, // Magic link authentication
    auth: `${envConfig.public.backURL}/api`, // Main application API access
    twoFactor: `${envConfig.public.backURL}/api/auth/two-factor`, // Two-factor authentication
    verify: `${envConfig.public.backURL}/api/auth/verify`, // Challenge authentication
    reset: `${envConfig.public.backURL}/api/auth/reset`, // Password reset tokens
    multiUser: `${envConfig.public.backURL}/api/auth/multi-user`, // Multi-user selection tokens
  },

  tokenTTL: envConfig.jwt.tokenTTL,
};
