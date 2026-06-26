/**
 * @file services/encryption/index.ts
 * @description Main export file for encryption services and utilities
 *
 * This module provides a unified interface for all encryption-related functionality,
 * including data encryption, file encryption, key sharing, and utility functions.
 */
// ============================================================================
// Service Class Exports
// ============================================================================

// Export service classes directly
export { KeySharingService } from "./key-sharing.service.ts";
export { FileEncryptionService } from "./file-encryption.service.ts";
export { DataAccessService } from "./data-access.service.ts";
export { EncryptionValidationHelper } from "./encryption-validation.helper.ts";
export { DataEncryptionHelperService } from "./data-encryption.helper.ts";
export { EncryptionSystemUserService } from "./user-encryption.helper.ts";
export { PasskeyPRFService } from "./passkey-prf.service.ts";
export { PerCredentialPRFService } from "./passkey-prf-credential.service.ts";
export type { IPRFEvaluationRequest, IPRFOutput } from "./passkey-prf.service.ts";
export { RotationEscrowService } from "./rotation-escrow.service.ts";
export { encryptionModeFromKeyType } from "./encryption.helper.ts";

// Generic data-sharing services
export { PermissionService } from "./permission.service.ts";
export { SharingService } from "./sharing.service.ts";
export { EncryptionSharingService } from "./encryption-sharing.service.ts";

// Export specific functions from encryption.helper.ts to avoid circular dependencies
export { useSymmetricDecrypt, useSymmetricEncrypt } from "./encryption.helper.ts";

// Export specific functions from key-sharing.service.ts
export {
  decryptPrivateKey,
  decryptWithECIES,
  encryptPrivateKey,
  encryptWithECIES,
  generateECIESKeyPair,
  generateEd25519KeyPair,
} from "./key-sharing.service.ts";

// ============================================================================
// Singleton Function Re-exports
// ============================================================================

// Re-export singleton functions from dedicated singletons file to avoid circular dependencies
export {
  getEncryptionKeySharingService,
  getEncryptionSharingService,
  getKeySharingService,
  getPermissionService,
  getSharingService,
} from "./singletons.ts";

// ============================================================================
// Type Exports
// ============================================================================

// Re-export types from centralized location
export type {
  EncryptionContext,
  EncryptionKeys,
  EncryptionResult,
  FileEncryptionConfig,
  IPermissionCacheAdapter,
  TextEncryptionConfig,
  TextEncryptionResult,
} from "@interfaces/encryption.ts";
