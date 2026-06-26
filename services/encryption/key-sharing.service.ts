/**
 * @file services/encryption/key-sharing.service.ts
 * @description Pure cryptographic key sharing service for data-specific master keys
 * Contains asymmetric encryption functions moved from encryption.helper.ts
 */

import { bytesToHex, ed25519, hexToBytes, randomBytes, x25519 } from "@deps";
import { safeEqual } from "@utils/shared/timing.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "./encryption.helper.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { Span } from "@interfaces/tracing.ts";
import { loggerAppSections } from "@logger/index.ts";

// ============================================================================
// Asymmetric Encryption Functions (moved from encryption.helper.ts)
// ============================================================================

/**
 * Generates an ECIES key pair using X25519
 * @returns Object containing hex-encoded public and private keys
 */
export function generateECIESKeyPair(): {
  publicKey: string;
  privateKey: string;
} {
  try {
    const privateKey = randomBytes(32);

    // Validate private key generation
    if (!privateKey || privateKey.length !== 32) {
      throwHttpError("ENCRYPTION.KEY_GEN_PRIVATE_KEY_FAILED");
    }

    const publicKey = x25519.getPublicKey(privateKey);

    // Validate public key generation
    if (!publicKey || publicKey.length !== 32) {
      throwHttpError("ENCRYPTION.KEY_GEN_PUBLIC_KEY_FAILED");
    }

    return {
      publicKey: bytesToHex(publicKey),
      privateKey: bytesToHex(privateKey),
    };
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }
    throwHttpError("ENCRYPTION.ECIES_KEYPAIR_GEN_FAILED", error);
  }
}

/**
 * Generates an Ed25519 key pair for signing
 * @returns Object containing hex-encoded public and private keys
 */
export function generateEd25519KeyPair(): {
  publicKey: string;
  privateKey: string;
} {
  try {
    const privateKey = ed25519.utils.randomPrivateKey();

    // Validate private key generation
    if (!privateKey || privateKey.length !== 32) {
      throwHttpError("ENCRYPTION.ED25519_PRIVATE_KEY_GEN_FAILED");
    }

    const publicKey = ed25519.getPublicKey(privateKey);

    // Validate public key generation
    if (!publicKey || publicKey.length !== 32) {
      throwHttpError("ENCRYPTION.ED25519_PUBLIC_KEY_GEN_FAILED");
    }

    return {
      publicKey: bytesToHex(publicKey),
      privateKey: bytesToHex(privateKey),
    };
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }
    throwHttpError("ENCRYPTION.ED25519_KEYPAIR_GEN_FAILED", error);
  }
}

/**
 * Encrypts data using ECIES (Elliptic Curve Integrated Encryption Scheme)
 * @param data - Data to encrypt (string or Uint8Array)
 * @param publicKeyHex - Recipient's public key (hex-encoded)
 * @returns Encrypted data as Uint8Array
 */
export async function encryptWithECIES(
  data: string | Uint8Array,
  publicKeyHex: string,
): Promise<Uint8Array> {
  try {
    // Validate input parameters
    if (!data || (typeof data !== "string" && !(data instanceof Uint8Array))) {
      throwHttpError("ENCRYPTION.ENCRYPT_DATA_INVALID_TYPE");
    }

    if (typeof data === "string" && data.length === 0) {
      throwHttpError("ENCRYPTION.ENCRYPT_DATA_EMPTY");
    }

    if (data instanceof Uint8Array && data.length === 0) {
      throwHttpError("ENCRYPTION.ENCRYPT_DATA_EMPTY");
    }

    if (!publicKeyHex || typeof publicKeyHex !== "string") {
      throwHttpError("ENCRYPTION.PUBLIC_KEY_REQUIRED");
    }

    // Validate hex format
    const cleanHex = publicKeyHex.replace(/\s/g, "");
    if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
      throwHttpError("ENCRYPTION.PUBLIC_KEY_INVALID_HEX");
    }

    if (cleanHex.length !== 64) { // 32 bytes * 2 hex chars per byte
      throwHttpError("ENCRYPTION.PUBLIC_KEY_INVALID_LENGTH");
    }

    const publicKey = hexToBytes(cleanHex);

    // Validate public key bytes
    if (!publicKey || publicKey.length !== 32) {
      throwHttpError("ENCRYPTION.PUBLIC_KEY_INVALID");
    }

    // Generate ephemeral key pair
    const ephemeralPrivateKey = randomBytes(32);
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

    // Validate ephemeral key generation
    if (!ephemeralPublicKey || ephemeralPublicKey.length !== 32) {
      throwHttpError("ENCRYPTION.EPHEMERAL_KEYPAIR_GEN_FAILED");
    }

    // Perform ECDH to get shared secret
    const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, publicKey);

    // Validate shared secret
    if (!sharedSecret || sharedSecret.length !== 32) {
      throwHttpError("ENCRYPTION.SHARED_SECRET_GEN_FAILED");
    }

    // Encrypt data with shared secret
    const encryptedData = await useSymmetricEncrypt({
      key: sharedSecret,
      data,
    });

    // Combine ephemeral public key + encrypted data
    const result = new Uint8Array(
      ephemeralPublicKey.length + encryptedData.length,
    );
    result.set(ephemeralPublicKey, 0);
    result.set(encryptedData, ephemeralPublicKey.length);

    sharedSecret.fill(0);
    ephemeralPrivateKey.fill(0);

    return result;
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }
    throwHttpError("ENCRYPTION.ECIES_ENCRYPT_FAILED", error);
  }
}

/**
 * Decrypts data encrypted with ECIES
 * @param encryptedDataHex - Encrypted data (hex-encoded)
 * @param privateKeyHex - Recipient's private key (hex-encoded)
 * @returns Decrypted data as string
 */
export async function decryptWithECIES(
  encryptedData: Uint8Array,
  privateKeyHex: string,
): Promise<Uint8Array> {
  try {
    // Validate input parameters
    if (!encryptedData || !(encryptedData instanceof Uint8Array)) {
      throwHttpError("ENCRYPTION.ENCRYPTED_DATA_UINT8ARRAY_REQUIRED");
    }

    if (!privateKeyHex || typeof privateKeyHex !== "string") {
      throwHttpError("ENCRYPTION.PRIVATE_KEY_REQUIRED");
    }

    // Validate hex formats
    const cleanPrivateKeyHex = privateKeyHex.replace(/\s/g, "");

    if (!/^[0-9a-fA-F]+$/.test(cleanPrivateKeyHex)) {
      throwHttpError("ENCRYPTION.PRIVATE_KEY_INVALID_HEX");
    }

    if (cleanPrivateKeyHex.length !== 64) { // 32 bytes * 2 hex chars per byte
      throwHttpError("ENCRYPTION.PRIVATE_KEY_INVALID_LENGTH");
    }

    const privateKey = hexToBytes(cleanPrivateKeyHex);

    // Validate minimum encrypted data length (ephemeral public key + encrypted data)
    // Updated for AES-GCM: 32-byte ephemeral key + 12-byte IV + 16-byte tag
    const MIN_ENCRYPTED_LENGTH = 32 + 12 + 16;
    if (encryptedData.length < MIN_ENCRYPTED_LENGTH) {
      throwHttpError("ENCRYPTION.ECIES_DATA_TOO_SHORT");
    }

    // Extract ephemeral public key (first 32 bytes)
    const ephemeralPublicKey = encryptedData.slice(0, 32);
    const encryptedDataContent = encryptedData.slice(32);

    // Validate ephemeral public key
    if (ephemeralPublicKey.length !== 32) {
      throwHttpError("ENCRYPTION.ECIES_EPHEMERAL_KEY_INVALID");
    }

    // Perform ECDH to get shared secret
    const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);

    // Validate shared secret
    if (!sharedSecret || sharedSecret.length !== 32) {
      throwHttpError("ENCRYPTION.SHARED_SECRET_FOR_DECRYPT_FAILED");
    }

    // Decrypt data with shared secret
    const decrypted = await useSymmetricDecrypt({
      key: sharedSecret,
      data: encryptedDataContent,
    });

    sharedSecret.fill(0);

    return decrypted;
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }
    throwHttpError("ENCRYPTION.ECIES_DECRYPT_FAILED", error);
  }
}

/**
 * Encrypts a private key with a master key
 * @param privateKeyHex - Private key to encrypt (hex-encoded)
 * @param masterKey - Master key for encryption (Uint8Array)
 * @returns Encrypted private key as hex string
 */
export async function encryptPrivateKey(
  privateKeyHex: string,
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  try {
    // Validate input parameters
    if (!privateKeyHex || typeof privateKeyHex !== "string") {
      throwHttpError("ENCRYPTION.PRIVATE_KEY_REQUIRED");
    }

    if (!masterKey || !(masterKey instanceof Uint8Array)) {
      throwHttpError("ENCRYPTION.MASTER_KEY_UINT8ARRAY_REQUIRED");
    }

    if (masterKey.length !== 32) {
      throwHttpError("ENCRYPTION.MASTER_KEY_INVALID_LENGTH");
    }

    // Validate hex format
    const cleanHex = privateKeyHex.replace(/\s/g, "");
    if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
      throwHttpError("ENCRYPTION.PRIVATE_KEY_INVALID_HEX");
    }

    if (cleanHex.length !== 64) { // 32 bytes * 2 hex chars per byte
      throwHttpError("ENCRYPTION.PRIVATE_KEY_INVALID_LENGTH");
    }

    // Check for weak keys (all zeros)
    const isAllZeros = masterKey.every((byte) => byte === 0);
    if (isAllZeros) {
      throwHttpError("ENCRYPTION.MASTER_KEY_ALL_ZEROS");
    }

    // Encode hex string as UTF-8 bytes so that decryptPrivateKey's
    // TextDecoder.decode() correctly recovers the original hex string.
    // Previously, passing a string caused useSymmetricEncrypt to treat it
    // as base64 (via TextTransformations.base64ToBuffer), breaking the
    // encrypt/decrypt round-trip.
    const hexBytes = new TextEncoder().encode(cleanHex);
    const encryptedData = await useSymmetricEncrypt({
      key: masterKey,
      data: hexBytes,
    });

    return encryptedData;
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }
    throwHttpError("ENCRYPTION.PRIVATE_KEY_ENCRYPT_FAILED", error);
  }
}

/**
 * Decrypts a private key with a master key
 * @param encryptedPrivateKeyHex - Encrypted private key (hex-encoded)
 * @param masterKey - Master key for decryption (Uint8Array)
 * @returns Decrypted private key as hex string
 */
export async function decryptPrivateKey(
  encryptedPrivateKey: Uint8Array,
  masterKey: Uint8Array,
): Promise<string> {
  try {
    // Validate input parameters
    if (!encryptedPrivateKey || !(encryptedPrivateKey instanceof Uint8Array)) {
      throwHttpError("ENCRYPTION.ENCRYPTED_PRIVATE_KEY_UINT8ARRAY_REQUIRED");
    }

    if (!masterKey || !(masterKey instanceof Uint8Array)) {
      throwHttpError("ENCRYPTION.MASTER_KEY_UINT8ARRAY_REQUIRED");
    }

    if (masterKey.length !== 32) {
      throwHttpError("ENCRYPTION.MASTER_KEY_INVALID_LENGTH");
    }

    // Validate minimum length for encrypted data
    // Updated for AES-GCM: 12-byte IV + 16-byte tag
    const MIN_ENCRYPTED_LENGTH = 12 + 16;
    if (encryptedPrivateKey.length < MIN_ENCRYPTED_LENGTH) {
      throwHttpError("ENCRYPTION.ENCRYPTED_PRIVATE_KEY_TOO_SHORT");
    }

    // Check for weak keys (all zeros)
    const isAllZeros = masterKey.every((byte) => byte === 0);
    if (isAllZeros) {
      throwHttpError("ENCRYPTION.MASTER_KEY_ALL_ZEROS");
    }

    const decryptedData = await useSymmetricDecrypt({
      key: masterKey,
      data: encryptedPrivateKey,
    });

    const result = typeof decryptedData === "string" ? decryptedData : new TextDecoder().decode(decryptedData);

    // Validate decrypted private key format
    const cleanResult = result.replace(/\s/g, "");
    if (!/^[0-9a-fA-F]+$/.test(cleanResult) || cleanResult.length !== 64) {
      throwHttpError("ENCRYPTION.DECRYPTED_PRIVATE_KEY_INVALID_FORMAT");
    }

    return result;
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }
    throwHttpError("ENCRYPTION.PRIVATE_KEY_DECRYPT_FAILED", error);
  }
}

/**
 * Key sharing service focused purely on cryptographic operations
 * No database dependencies - only handles encryption/decryption operations
 */
export class KeySharingService {
  /**
   * Shares a data master key with another user using ECIES encryption
   * Uses the asymmetric functions directly
   *
   * @param ownerEncryptedDataMasterKey - The owner's encrypted data master key (encrypted with owner's user master key)
   * @param ownerUserMasterKey - The owner's user master key (used to decrypt the data master key)
   * @param targetUserPublicKey - The target user's public key (used to encrypt for target)
   * @returns The data master key encrypted with target user's public key (ECIES)
   */
  async shareDataMasterKeyAsymmetric(
    ownerEncryptedDataMasterKey: Uint8Array,
    ownerUserMasterKey: Uint8Array,
    targetUserPublicKey: string,
  ): Promise<Uint8Array> {
    // Validate input parameters
    if (
      !ownerEncryptedDataMasterKey ||
      !(ownerEncryptedDataMasterKey instanceof Uint8Array)
    ) {
      throwHttpError("ENCRYPTION.INVALID_KEY");
    }

    if (!ownerUserMasterKey || !(ownerUserMasterKey instanceof Uint8Array)) {
      throwHttpError("ENCRYPTION.INVALID_KEY");
    }

    if (!targetUserPublicKey || typeof targetUserPublicKey !== "string") {
      throwHttpError("ENCRYPTION.INVALID_KEY");
    }

    // Validate hex formats
    const cleanTargetKey = targetUserPublicKey.replace(/\s/g, "");

    if (
      !/^[0-9a-fA-F]+$/.test(cleanTargetKey) || cleanTargetKey.length !== 64
    ) {
      throwHttpError("VALIDATION.INVALID_FORMAT");
    }

    return await tracedWithServiceErrorHandling(
      "KeySharingService.shareDataMasterKeyAsymmetric",
      {
        service: "KeySharingService",
        method: "shareDataMasterKeyAsymmetric",
        section: loggerAppSections.USER_ENCRYPTED,
        details: {
          operation: "shareDataMasterKeyAsymmetric",
        },
      },
      "ENCRYPTION.ENCRYPTION_FAILED",
      async (_span: Span) => {
        // Decrypt the data master key with owner's user master key
        const decryptedDataMasterKey = await useSymmetricDecrypt({
          key: ownerUserMasterKey,
          data: ownerEncryptedDataMasterKey,
        });

        // Validate decrypted data master key
        if (!decryptedDataMasterKey || decryptedDataMasterKey.length === 0) {
          throwHttpError("ENCRYPTION.DECRYPTION_FAILED");
        }

        // Encrypt the data master key with target user's public key using ECIES
        return await encryptWithECIES(decryptedDataMasterKey, cleanTargetKey);
      },
    );
  }

  /**
   * Decrypts an ECIES shared data master key
   * Uses the asymmetric functions directly
   */
  async decryptSharedDataMasterKey(
    eciesEncryptedDataMasterKey: Uint8Array,
    targetUserEncryptedPrivateKey: Uint8Array,
    targetUserMasterKey: Uint8Array,
  ): Promise<Uint8Array> {
    // Validate input parameters
    if (
      !eciesEncryptedDataMasterKey ||
      !(eciesEncryptedDataMasterKey instanceof Uint8Array)
    ) {
      throwHttpError("ENCRYPTION.INVALID_KEY");
    }

    if (
      !targetUserEncryptedPrivateKey ||
      !(targetUserEncryptedPrivateKey instanceof Uint8Array)
    ) {
      throwHttpError("ENCRYPTION.INVALID_KEY");
    }

    if (!targetUserMasterKey || !(targetUserMasterKey instanceof Uint8Array)) {
      throwHttpError("ENCRYPTION.INVALID_KEY");
    }

    // Validate Uint8Array lengths
    if (targetUserMasterKey.length !== 32) {
      throwHttpError("VALIDATION.INVALID_FORMAT");
    }

    if (targetUserEncryptedPrivateKey.length < 28) { // Minimum encrypted private key size (12-byte IV + 16-byte tag)
      throwHttpError("VALIDATION.INVALID_FORMAT");
    }

    return await tracedWithServiceErrorHandling(
      "KeySharingService.decryptSharedDataMasterKey",
      {
        service: "KeySharingService",
        method: "decryptSharedDataMasterKey",
        section: loggerAppSections.USER_ENCRYPTED,
        details: {
          operation: "decryptSharedDataMasterKey",
        },
      },
      "ENCRYPTION.DECRYPTION_FAILED",
      async (_span: Span) => {
        // Decrypt the target user's private key with their master key
        const targetUserPrivateKey = await decryptPrivateKey(
          targetUserEncryptedPrivateKey,
          targetUserMasterKey,
        );

        // Validate decrypted private key
        if (!targetUserPrivateKey || targetUserPrivateKey.length === 0) {
          throwHttpError("ENCRYPTION.DECRYPTION_FAILED");
        }

        // Decrypt the data master key with the target user's private key using ECIES
        const decryptedDataMasterKey = await decryptWithECIES(eciesEncryptedDataMasterKey, targetUserPrivateKey);

        // Validate the decrypted result
        if (!decryptedDataMasterKey || decryptedDataMasterKey.length === 0) {
          throwHttpError("ENCRYPTION.DECRYPTION_FAILED");
        }

        return decryptedDataMasterKey;
      },
    );
  }

  /**
   * Validates that a user has the correct permission level for an operation
   * Uses timing-safe comparison to prevent timing attacks
   */
  validatePermission(
    userPermission: string,
    requiredPermission: string,
  ): boolean {
    // Validate input parameters
    if (!userPermission || typeof userPermission !== "string") {
      throwHttpError("VALIDATION.INVALID_FORMAT");
    }

    if (!requiredPermission || typeof requiredPermission !== "string") {
      throwHttpError("VALIDATION.INVALID_FORMAT");
    }

    const permissionLevels = ["read", "write", "admin"] as const;

    // Use timing-safe comparison for permission level matching
    let userLevel = -1;
    let requiredLevel = -1;

    for (let i = 0; i < permissionLevels.length; i++) {
      if (safeEqual(userPermission.toLowerCase(), permissionLevels[i])) {
        userLevel = i;
      }
      if (safeEqual(requiredPermission.toLowerCase(), permissionLevels[i])) {
        requiredLevel = i;
      }
    }

    // Validate permission levels exist
    if (userLevel === -1) {
      throwHttpError("VALIDATION.INVALID_ENUM_VALUE");
    }

    if (requiredLevel === -1) {
      throwHttpError("VALIDATION.INVALID_ENUM_VALUE");
    }

    // Check if user has sufficient permission level
    const hasPermission = userLevel >= requiredLevel;

    if (!hasPermission) {
      throwHttpError("COMMON.ACCESS_DENIED");
    }

    return hasPermission;
  }
}
