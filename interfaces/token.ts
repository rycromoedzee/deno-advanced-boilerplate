/**
 * @file interfaces/token.ts
 * @description Token-related interfaces and types
 * These interfaces define the structure for token operations and payloads
 */

import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "../constants/token.ts";

/**
 * Token request headers interface
 */
export interface ITokensRequestHeaders {
  userAgent: string;
  accept: string;
  lang: string;
}

/**
 * Base token creation payload interface
 */
export interface ITokensCreatePayloadBase {
  sub: string;
  type: JWT_TOKEN_TYPES;
  aud: (typeof JWT_TOKEN_CONFIG.audiences)[
    keyof typeof JWT_TOKEN_CONFIG.audiences
  ];
}

/**
 * Email token creation payload interface
 */
export interface ITokensCreateEmailPayload extends ITokensCreatePayloadBase {
  category: string;
}

/**
 * JWT token creation payload interface
 */
export interface ITokensCreateJWTPayload extends ITokensCreatePayloadBase {
  iat: number;
  exp: number;
  iss: string;
  nbf: number;
}
