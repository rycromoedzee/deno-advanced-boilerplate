/**
 * @file deps.ts
 * @description Centralized external dependency re-exports for the Deno + Hono app
 */
// HONO RELATED
export type { Context as HonoContext, Next as HonoNext } from "hono";
export { createRoute, OpenAPIHono, type RouteConfig, type RouteHandler, z } from "@hono/zod-openapi";
export { serveStatic } from "hono/deno";
export { csrf } from "hono/csrf";
export { cors } from "hono/cors";
export { secureHeaders } from "hono/secure-headers";
export { getCookie, getSignedCookie, setCookie, setSignedCookie } from "hono/cookie";
export { sign as jwtSign, verify as jwtVerify } from "hono/jwt";
export { JwtTokenExpired, JwtTokenInvalid, JwtTokenNotBefore, JwtTokenSignatureMismatched } from "hono/utils/jwt/types";
export { HTTPException } from "hono/http-exception";
export { stream, streamSSE } from "hono/streaming";

// DB RELATED
export { drizzle } from "drizzle-orm/libsql";
export { migrate } from "drizzle-orm/libsql/migrator";
export { customType, index, integer, primaryKey, text, unique } from "drizzle-orm/sqlite-core";
export { SQLiteTable } from "drizzle-orm/sqlite-core";
export type { AnySQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
export {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  ne,
  not,
  or,
  relations,
  sql,
  sum,
} from "drizzle-orm";
export type { InferInsertModel, SQL } from "drizzle-orm";

export { createClient } from "@libsql/client";
export { createClient as createNodeClient } from "@libsql/client/node";
export { createClient as createWebClient } from "@libsql/client";
export type { Client as LibSQLClient } from "@libsql/client";

// CYPHERS & HASHES
export { hash as argon2Hash, Variant as Argon2Variant, verify as argon2Verify, Version as Argon2Version } from "jsr:@felix/argon2";
export { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
export { hmac } from "@noble/hashes/hmac.js";
export { sha1 } from "@noble/hashes/legacy.js";
export { blake3 } from "@noble/hashes/blake3.js";
export { sha3_512 as sha3 } from "@noble/hashes/sha3.js";
export { sha256 } from "@noble/hashes/sha2.js";

// ELLIPTIC CURVE CRYPTOGRAPHY
export { x25519 } from "@noble/curves/ed25519";
export { ed25519 } from "@noble/curves/ed25519";

// BIP39 for recovery phrases
export { generateMnemonic, validateMnemonic } from "bip39";

// STORAGE
export * as BunnyStorageSDK from "@bunny.net/storage-sdk";
export {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
export { Upload } from "@aws-sdk/lib-storage";
export { Image as Imagescript } from "@matmen/imagescript";

// LOGGING & ANALYTICS
export { Logger } from "onjara/optic";
export { Scalar } from "scalar";

// EMAIL HANDLER
export { htmlToText } from "html-to-text";
export { compile, type TemplateFunction } from "ejs";
export { Resend } from "resend";
export { createTransport } from "nodemailer";

// WEBAUTHN / PASSKEY (@simplewebauthn)
export {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
export type {
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  PublicKeyCredentialCreationOptionsJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
export type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  Base64URLString,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";

// SERVICES
export { connect as redisDbConnect, type Redis } from "jsr:@db/redis";

// Node specific exports
export { AsyncLocalStorage } from "node:async_hooks";
export { Buffer } from "node:buffer";
export { EventEmitter } from "node:events";
export { createCipheriv, createDecipheriv, createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";

export {
  basename as stdBasename,
  dirname as stdDirname,
  extname as stdExtname,
  join as stdJoin,
  normalize as stdNormalize,
  resolve as stdResolve,
} from "@std/path";
