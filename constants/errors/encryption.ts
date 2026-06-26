/**
 * @file constants/errors/encryption.ts
 * @description Encryption error message constants
 */
/**
 * Encryption and Security Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Encryption and Security Errors
 */
export const ENCRYPTION_ERRORS = {
  DECRYPTION_FAILED: {
    message: "Failed to decrypt data",
    messageKey: "encryption.decryption-failed",
    statusCode: 500,
  },
  ENCRYPTION_FAILED: {
    message: "Failed to encrypt data",
    messageKey: "encryption.encryption-failed",
    statusCode: 500,
  },
  KEY_GENERATION_FAILED: {
    message: "Failed to generate encryption key",
    messageKey: "encryption.key-generation-failed",
    statusCode: 500,
  },
  KEY_DERIVATION_FAILED: {
    message: "Failed to derive encryption key",
    messageKey: "encryption.key-derivation-failed",
    statusCode: 500,
  },
  INVALID_KEY: {
    message: "Invalid encryption key provided",
    messageKey: "encryption.invalid-key",
    statusCode: 400,
  },
  RECIPIENT_KEYS_NOT_INITIALIZED: {
    message: "Recipient must sign in once to initialize encryption keys before sharing",
    messageKey: "encryption.recipient-keys-not-initialized",
    statusCode: 409,
  },
  KEY_NOT_FOUND: {
    message: "Encryption key not found",
    messageKey: "encryption.key-not-found",
    statusCode: 404,
  },
  PRF_NOT_CONFIGURED_FOR_CREDENTIAL: {
    message: "PRF not configured for credential",
    messageKey: "encryption.prf-not-configured-for-credential",
    statusCode: 404,
  },
  PRF_ALREADY_CONFIGURED: {
    message: "PRF already configured for credential",
    messageKey: "encryption.prf-already-configured",
    statusCode: 409,
  },
  KEY_EXPIRED: {
    message: "Encryption key has expired",
    messageKey: "encryption.key-expired",
    statusCode: 401,
  },
  INVALID_ALGORITHM: {
    message: "Invalid encryption algorithm specified",
    messageKey: "encryption.invalid-algorithm",
    statusCode: 400,
  },
  SIGNATURE_VERIFICATION_FAILED: {
    message: "Digital signature verification failed",
    messageKey: "encryption.signature-verification-failed",
    statusCode: 401,
  },
  CERTIFICATE_INVALID: {
    message: "Invalid or expired certificate",
    messageKey: "encryption.certificate-invalid",
    statusCode: 401,
  },
  UNSUPPORTED_MODE: {
    message: "Unsupported encryption mode",
    messageKey: "encryption.unsupported-mode",
    statusCode: 500,
  },
  ALREADY_OPTED_IN: {
    message: "User has already opted in to enhanced encryption",
    messageKey: "encryption.already-opted-in",
    statusCode: 400,
  },
  NOT_ENABLED: {
    message: "Enhanced encryption is not enabled for this user",
    messageKey: "encryption.not-enabled",
    statusCode: 400,
  },
  PASSWORD_REQUIRED: {
    message: "User has a password set. Please use the password-based opt-in route.",
    messageKey: "encryption.password-required",
    statusCode: 400,
  },
  PRF_SETUP_REQUIRED: {
    message: "PRF setup required. Please authenticate with your passkey to enable PRF-based encryption.",
    messageKey: "encryption.prf-setup-required",
    statusCode: 400,
  },
  SETUP_FAILED: {
    message: "Failed to set up enhanced encryption",
    messageKey: "encryption.setup-failed",
    statusCode: 500,
  },
  VERIFICATION_FAILED: {
    message: "Failed to verify recovery phrase",
    messageKey: "encryption.verification-failed",
    statusCode: 500,
  },
  ROTATION_NOT_ENABLED: {
    message: "Master key rotation requires enhanced encryption to be enabled",
    messageKey: "encryption.rotation-not-enabled",
    statusCode: 400,
  },
  ROTATION_ESCROW_EXPIRED: {
    message: "Master key rotation escrow has expired. Please initiate rotation again.",
    messageKey: "encryption.rotation-escrow-expired",
    statusCode: 410,
  },
  ROTATION_RECOVERY_PHRASE_REQUIRED: {
    message: "Recovery phrase is required for master key rotation",
    messageKey: "encryption.rotation-recovery-phrase-required",
    statusCode: 400,
  },
  ROTATION_STALE_PASSKEY: {
    message: "This passkey's encryption wrap is outdated. Please provide your recovery phrase to update it.",
    messageKey: "encryption.rotation-stale-passkey",
    statusCode: 409,
  },
  ROTATE_MASTER_KEY_FAILED: {
    message: "Failed to rotate master key",
    messageKey: "encryption.rotate-master-key-failed",
    statusCode: 500,
  },
  PRF_ATTEMPT_ID_REQUIRED: {
    message: "Attempt ID is required",
    messageKey: "encryption.prf-attempt-id-required",
    statusCode: 400,
  },
  INVALID_PRF_OUTPUT: {
    message: "PRF output is required",
    messageKey: "encryption.invalid-prf-output",
    statusCode: 400,
  },
  RECOVERY_PHRASE_REQUIRED: {
    message: "Recovery phrase is required",
    messageKey: "encryption.recovery-phrase-required",
    statusCode: 400,
  },
  PASSWORD_REQUIRED_INPUT: {
    message: "Password is required",
    messageKey: "encryption.password-required-input",
    statusCode: 400,
  },
  INVALID_TYPE: {
    message: "Invalid encryption type provided",
    messageKey: "encryption.invalid-type",
    statusCode: 400,
  },
  SYSTEM_KEY_MISSING: {
    message: "System encryption key not configured",
    messageKey: "encryption.system-key-missing",
    statusCode: 500,
  },
  SYSTEM_KEY_INVALID: {
    message: "System encryption key must be a non-empty string",
    messageKey: "encryption.system-key-invalid",
    statusCode: 500,
  },
  INVALID_DATA: {
    message: "Invalid data provided",
    messageKey: "encryption.invalid-data",
    statusCode: 400,
  },
  INVALID_DATA_LENGTH: {
    message: "Encrypted data has invalid length",
    messageKey: "encryption.invalid-data-length",
    statusCode: 400,
  },
  INVALID_STREAM: {
    message: "Invalid stream provided",
    messageKey: "encryption.invalid-stream",
    statusCode: 400,
  },
  INVALID_STREAM_TYPE: {
    message: "Value must be a ReadableStream",
    messageKey: "encryption.invalid-stream-type",
    statusCode: 400,
  },
  STREAM_LOCKED: {
    message: "Stream is already locked by another reader",
    messageKey: "encryption.stream-locked",
    statusCode: 400,
  },
  INVALID_KEY_TYPE: {
    message: "Invalid encryption key type",
    messageKey: "encryption.invalid-key-type",
    statusCode: 400,
  },
  INVALID_KEY_FORMAT: {
    message: "Invalid key format",
    messageKey: "encryption.invalid-key-format",
    statusCode: 400,
  },
  INVALID_KEY_LENGTH: {
    message: "Invalid key length",
    messageKey: "encryption.invalid-key-length",
    statusCode: 400,
  },
  WEAK_KEY: {
    message: "Encryption key cannot be all zeros",
    messageKey: "encryption.weak-key",
    statusCode: 400,
  },
  INVALID_CHUNK_SIZE: {
    message: "Invalid chunk size",
    messageKey: "encryption.invalid-chunk-size",
    statusCode: 400,
  },
  CHUNK_SIZE_TOO_LARGE: {
    message: "Chunk size exceeds maximum",
    messageKey: "encryption.chunk-size-too-large",
    statusCode: 400,
  },
  INVALID_TEXT: {
    message: "Text must be a non-empty string",
    messageKey: "encryption.invalid-text",
    statusCode: 400,
  },
  INVALID_CONFIGURATION: {
    message: "Invalid encryption configuration",
    messageKey: "encryption.invalid-configuration",
    statusCode: 500,
  },
  INVALID_NONCE: {
    message: "Invalid nonce",
    messageKey: "encryption.invalid-nonce",
    statusCode: 500,
  },
  KEY_EXCHANGE_FAILED: {
    message: "Key exchange failed",
    messageKey: "encryption.key-exchange-failed",
    statusCode: 500,
  },
  FAILED: {
    message: "Encryption operation failed",
    messageKey: "encryption.failed",
    statusCode: 500,
  },
  INVALID_MASTER_KEY: {
    message: "Master key must be raw 32-byte binary (Uint8Array)",
    messageKey: "encryption.invalid-key",
    statusCode: 500,
  },
  // --- Promoted from static throwHttpErrorWithCustomMessage messages
  //     (services/encryption/key-sharing.service.ts + encryption*.helper.ts) ---
  KEY_GEN_PRIVATE_KEY_FAILED: {
    message: "Failed to generate valid private key",
    messageKey: "encryption.private-key-generation-failed",
    statusCode: 500,
  },
  KEY_GEN_PUBLIC_KEY_FAILED: {
    message: "Failed to generate valid public key",
    messageKey: "encryption.public-key-generation-failed",
    statusCode: 500,
  },
  ECIES_KEYPAIR_GEN_FAILED: {
    message: "Failed to generate ECIES key pair",
    messageKey: "encryption.ecies-keypair-generation-failed",
    statusCode: 500,
  },
  ED25519_PRIVATE_KEY_GEN_FAILED: {
    message: "Failed to generate valid Ed25519 private key",
    messageKey: "encryption.ed25519-private-key-generation-failed",
    statusCode: 500,
  },
  ED25519_PUBLIC_KEY_GEN_FAILED: {
    message: "Failed to generate valid Ed25519 public key",
    messageKey: "encryption.ed25519-public-key-generation-failed",
    statusCode: 500,
  },
  ED25519_KEYPAIR_GEN_FAILED: {
    message: "Failed to generate Ed25519 key pair",
    messageKey: "encryption.ed25519-keypair-generation-failed",
    statusCode: 500,
  },
  EPHEMERAL_KEYPAIR_GEN_FAILED: {
    message: "Failed to generate ephemeral key pair",
    messageKey: "encryption.ephemeral-keypair-generation-failed",
    statusCode: 500,
  },
  ENCRYPT_DATA_INVALID_TYPE: {
    message: "Data to encrypt must be a non-empty string or Uint8Array",
    messageKey: "encryption.encrypt-data-invalid-type",
    statusCode: 400,
  },
  ENCRYPT_DATA_EMPTY: {
    message: "Data to encrypt cannot be empty",
    messageKey: "encryption.encrypt-data-empty",
    statusCode: 400,
  },
  ENCRYPTED_DATA_UINT8ARRAY_REQUIRED: {
    message: "Encrypted data must be a Uint8Array",
    messageKey: "encryption.encrypted-data-uint8array-required",
    statusCode: 400,
  },
  PUBLIC_KEY_REQUIRED: {
    message: "Public key must be a non-empty hex string",
    messageKey: "encryption.public-key-required",
    statusCode: 400,
  },
  PUBLIC_KEY_INVALID_HEX: {
    message: "Public key must be valid hexadecimal",
    messageKey: "encryption.public-key-invalid-hex",
    statusCode: 400,
  },
  PUBLIC_KEY_INVALID_LENGTH: {
    message: "Public key must be exactly 64 hex characters (32 bytes)",
    messageKey: "encryption.public-key-invalid-length",
    statusCode: 400,
  },
  PUBLIC_KEY_INVALID: {
    message: "Invalid public key format",
    messageKey: "encryption.public-key-invalid",
    statusCode: 400,
  },
  PRIVATE_KEY_REQUIRED: {
    message: "Private key must be a non-empty hex string",
    messageKey: "encryption.private-key-required",
    statusCode: 400,
  },
  PRIVATE_KEY_INVALID_HEX: {
    message: "Private key must be valid hexadecimal",
    messageKey: "encryption.private-key-invalid-hex",
    statusCode: 400,
  },
  PRIVATE_KEY_INVALID_LENGTH: {
    message: "Private key must be exactly 64 hex characters (32 bytes)",
    messageKey: "encryption.private-key-invalid-length",
    statusCode: 400,
  },
  SHARED_SECRET_GEN_FAILED: {
    message: "Failed to generate shared secret",
    messageKey: "encryption.shared-secret-generation-failed",
    statusCode: 500,
  },
  SHARED_SECRET_FOR_DECRYPT_FAILED: {
    message: "Failed to generate shared secret for decryption",
    messageKey: "encryption.shared-secret-for-decrypt-failed",
    statusCode: 500,
  },
  ECIES_ENCRYPT_FAILED: {
    message: "Failed to encrypt with ECIES",
    messageKey: "encryption.ecies-encrypt-failed",
    statusCode: 500,
  },
  ECIES_DECRYPT_FAILED: {
    message: "Failed to decrypt with ECIES",
    messageKey: "encryption.ecies-decrypt-failed",
    statusCode: 500,
  },
  ECIES_DATA_TOO_SHORT: {
    message: "Encrypted data is too short to be valid ECIES data",
    messageKey: "encryption.ecies-data-too-short",
    statusCode: 400,
  },
  ECIES_EPHEMERAL_KEY_INVALID: {
    message: "Invalid ephemeral public key in encrypted data",
    messageKey: "encryption.ecies-ephemeral-key-invalid",
    statusCode: 400,
  },
  MASTER_KEY_UINT8ARRAY_REQUIRED: {
    message: "Master key must be a Uint8Array",
    messageKey: "encryption.master-key-uint8array-required",
    statusCode: 400,
  },
  MASTER_KEY_INVALID_LENGTH: {
    message: "Master key must be exactly 32 bytes",
    messageKey: "encryption.master-key-invalid-length",
    statusCode: 400,
  },
  MASTER_KEY_ALL_ZEROS: {
    message: "Master key cannot be all zeros",
    messageKey: "encryption.master-key-all-zeros",
    statusCode: 400,
  },
  MASTER_KEY_STRING_REQUIRED: {
    message: "User master key must be a non-empty string",
    messageKey: "encryption.master-key-string-required",
    statusCode: 400,
  },
  PRIVATE_KEY_ENCRYPT_FAILED: {
    message: "Failed to encrypt private key",
    messageKey: "encryption.private-key-encrypt-failed",
    statusCode: 500,
  },
  ENCRYPTED_PRIVATE_KEY_UINT8ARRAY_REQUIRED: {
    message: "Encrypted private key must be a Uint8Array",
    messageKey: "encryption.encrypted-private-key-uint8array-required",
    statusCode: 400,
  },
  ENCRYPTED_PRIVATE_KEY_TOO_SHORT: {
    message: "Encrypted private key is too short to be valid",
    messageKey: "encryption.encrypted-private-key-too-short",
    statusCode: 400,
  },
  DECRYPTED_PRIVATE_KEY_INVALID_FORMAT: {
    message: "Decrypted private key has invalid format",
    messageKey: "encryption.decrypted-private-key-invalid-format",
    statusCode: 500,
  },
  PRIVATE_KEY_DECRYPT_FAILED: {
    message: "Failed to decrypt private key",
    messageKey: "encryption.private-key-decrypt-failed",
    statusCode: 500,
  },
  SYMMETRIC_ENCRYPT_FAILED: {
    message: "Symmetric encryption failed",
    messageKey: "encryption.symmetric-encrypt-failed",
    statusCode: 500,
  },
  SYMMETRIC_DECRYPT_FAILED: {
    message: "Symmetric decryption failed - possibly corrupted data or wrong key",
    messageKey: "encryption.symmetric-decrypt-failed",
    statusCode: 500,
  },
  NONCE_MUST_BE_12_BYTES: {
    message: "Nonce must be exactly 12 bytes for ChaCha20-Poly1305",
    messageKey: "encryption.nonce-must-be-12-bytes",
    statusCode: 400,
  },
  NONCE_REQUIRED_WHEN_ABSENT: {
    message: "When hasNonce is false, a 12-byte nonce must be provided",
    messageKey: "encryption.nonce-required-when-absent",
    statusCode: 400,
  },
  ENCRYPTED_DATA_TOO_SHORT_FOR_NONCE: {
    message: "Encrypted data is too short to contain valid nonce and ciphertext",
    messageKey: "encryption.encrypted-data-too-short-for-nonce",
    statusCode: 400,
  },
  NONCE_LENGTH_INVALID_IN_DATA: {
    message: "Invalid nonce length in encrypted data",
    messageKey: "encryption.nonce-length-invalid-in-data",
    statusCode: 400,
  },
  ENCRYPTION_KEY_REQUIRED: {
    message: "Encryption key cannot be null or undefined",
    messageKey: "encryption.encryption-key-required",
    statusCode: 400,
  },
  ENCRYPTION_KEY_UINT8ARRAY_REQUIRED: {
    message: "Encryption key must be a Uint8Array",
    messageKey: "encryption.encryption-key-uint8array-required",
    statusCode: 400,
  },
  ENCRYPTION_KEY_INVALID_LENGTH: {
    message: "Encryption key must be exactly 32 bytes",
    messageKey: "encryption.encryption-key-invalid-length",
    statusCode: 400,
  },
  CHUNK_SIZE_MUST_BE_POSITIVE: {
    message: "Chunk size must be a positive integer",
    messageKey: "encryption.chunk-size-must-be-positive",
    statusCode: 400,
  },
  CHUNK_SIZE_EXCEEDS_1MB: {
    message: "Chunk size cannot exceed 1MB",
    messageKey: "encryption.chunk-size-exceeds-1mb",
    statusCode: 400,
  },
  DISABLE_MIGRATION_INCOMPLETE: {
    message: "Failed to disable enhanced encryption: one or more document keys could not be migrated. No changes were applied.",
    messageKey: "encryption.disable-migration-incomplete",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

/**
 * WebAuthn/YubiKey Errors
 */
export const WEBAUTHN_ERRORS = {
  TIMEOUT: {
    message: "YubiKey operation timed out. Please try again and touch your YubiKey when prompted",
    messageKey: "webauthn.timeout",
    statusCode: 408,
  },
  PERMISSION_DENIED: {
    message: "Permission denied. Please ensure your YubiKey is properly inserted and try again",
    messageKey: "webauthn.permission-denied",
    statusCode: 403,
  },
  DEVICE_NOT_FOUND: {
    message: "YubiKey not detected. Please ensure your YubiKey is connected and try again",
    messageKey: "webauthn.device-not-found",
    statusCode: 404,
  },
  INVALID_STATE: {
    message: "Session expired. Please try logging in again",
    messageKey: "webauthn.invalid-state",
    statusCode: 401,
  },
  REGISTRATION_FAILED: {
    message: "Failed to register security key",
    messageKey: "webauthn.registration-failed",
    statusCode: 500,
  },
  AUTHENTICATION_FAILED: {
    message: "Security key authentication failed",
    messageKey: "webauthn.authentication-failed",
    statusCode: 401,
  },
  CHALLENGE_INVALID: {
    message: "Invalid authentication challenge",
    messageKey: "webauthn.challenge-invalid",
    statusCode: 400,
  },
  CREDENTIAL_NOT_FOUND: {
    message: "Security key credential not found",
    messageKey: "webauthn.credential-not-found",
    statusCode: 404,
  },
} as const satisfies ErrorCategory;

export type EncryptionErrorKey = keyof typeof ENCRYPTION_ERRORS;
export type WebAuthnErrorKey = keyof typeof WEBAUTHN_ERRORS;
