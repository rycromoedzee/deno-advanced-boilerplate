/**
 * @file db/enums/encryption.enum.ts
 * @description Encryption DB enum definitions
 */
export enum DB_ENUM_ENCRYPTION_MODE {
  APP_CONTROLLED = "app",
  USER_CONTROLLED = "user",
  ASYMMETRIC = "asymmetric",
  PASSWORD_PROTECTED_PUBLIC = "public-protected",
  PUBLIC_UNPROTECTED = "public",
}
