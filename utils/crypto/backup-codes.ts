/**
 * @file utils/crypto/backup-codes.ts
 * @description MFA backup code generation/verification
 */
/**
 * Backup Code Generation Utilities
 *
 * This module provides utilities for generating and validating backup codes,
 * commonly used as recovery methods in two-factor authentication (2FA) systems.
 *
 * Storage format (compact binary):
 * - 16-byte shared salt
 * - 10 × 32-byte blake3 hashes (one per backup code)
 * - Total: 336 bytes raw → AES-GCM encrypted → Base64 encoded for DB storage
 */

import { randomBytes } from "@deps";
import { hashData } from "@utils/text/index.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "@services/encryption/index.ts";
import { TextHashing } from "@utils/text/index.ts";
import { envConfig } from "@config/env.ts";
import { safeEqual } from "@utils/shared/index.ts";
import type { IBackupCodeBinaryBlob } from "@interfaces/auth.ts";

/**
 * Backup Code Configuration interface
 */
export interface BackupCodeConfig {
  codeLength?: number;
  numberOfCodes?: number;
  encryptionKey?: Uint8Array;
  base32Alphabet?: string;
}

/** Shared salt size in bytes */
const SALT_SIZE = 16;

/** Hash output size in bytes (blake3 default) */
const HASH_SIZE = 32;

/**
 * Default backup code configuration
 */
export const DEFAULT_BACKUP_CODE_CONFIG: Required<BackupCodeConfig> = {
  codeLength: 14,
  numberOfCodes: 8,
  encryptionKey: TextHashing.generateHashFromKeyForAuthTwoFactor(
    envConfig.auth.generalEncryptionKey!,
  ),
  base32Alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
};

/**
 * Backup Code Generation Service
 *
 * Provides methods for generating and managing backup codes for 2FA recovery
 */
export class BackupCodeGenerationService {
  private static config: Required<BackupCodeConfig> = DEFAULT_BACKUP_CODE_CONFIG;

  /**
   * Configure backup code generation parameters
   * @param config Configuration options
   */
  static configure(config: BackupCodeConfig): void {
    this.config = { ...DEFAULT_BACKUP_CODE_CONFIG, ...config };
  }

  /**
   * Get current configuration
   * @returns Current backup code configuration
   */
  static getConfig(): Required<BackupCodeConfig> {
    return { ...this.config };
  }

  /**
   * Generate a single backup code
   * @returns A single backup code string
   */
  private static generateBackupCode(): string {
    const bytes = randomBytes(this.config.codeLength);
    let id = "";
    for (let i = 0; i < this.config.codeLength; i++) {
      id += this.config.base32Alphabet[bytes[i]! % this.config.base32Alphabet.length];
    }
    return id;
  }

  /**
   * Generate backup codes with their hashed representations
   * @returns Object containing plain backup codes and serialized hashed representation
   */
  static async generateTOTPBackupCodes() {
    // Generate the plain backup codes (shown to user once)
    const backupCodes = Array.from({ length: this.config.numberOfCodes })
      .fill(null)
      .map(() => this.generateBackupCode())
      .map((code) => `${code.slice(0, 7)}-${code.slice(7)}`);

    // Generate a single shared salt for all codes
    const sharedSalt = randomBytes(SALT_SIZE);

    // Hash each code with the shared salt
    const hashes: Uint8Array[] = backupCodes.map((code) => {
      const normalizedCode = code.replace(/-/g, "");
      const codeData = new TextEncoder().encode(normalizedCode);
      const saltedCode = new Uint8Array(sharedSalt.length + codeData.length);
      saltedCode.set(sharedSalt);
      saltedCode.set(codeData, sharedSalt.length);
      return hashData(saltedCode);
    });

    // Pack into binary blob: [salt:16B][hash0:32B]...[hash9:32B]
    const binaryBlob = this.packBinaryBlob(sharedSalt, hashes);

    // Serialize (encrypt + Base64 encode) for storage
    const serializedHashedBackupCodes = await this.serializeBackUpCodesForStorage(
      binaryBlob,
    );

    return {
      backupCodes,
      serializedHashedBackupCodes,
    };
  }

  /**
   * Pack salt and hashes into a compact binary blob
   * Layout: [shared_salt: 16 bytes][hash_0: 32 bytes]...[hash_N: 32 bytes]
   */
  private static packBinaryBlob(salt: Uint8Array, hashes: Uint8Array[]): IBackupCodeBinaryBlob {
    const totalSize = SALT_SIZE + (hashes.length * HASH_SIZE);
    const blob = new Uint8Array(totalSize);

    // Write salt at offset 0
    blob.set(salt, 0);

    // Write each hash at its fixed offset
    for (let i = 0; i < hashes.length; i++) {
      blob.set(hashes[i]!, SALT_SIZE + (i * HASH_SIZE));
    }

    return blob;
  }

  /**
   * Extract salt from binary blob
   */
  private static extractSalt(blob: IBackupCodeBinaryBlob): Uint8Array {
    return blob.slice(0, SALT_SIZE);
  }

  /**
   * Extract a specific hash from binary blob by index
   */
  private static extractHash(blob: IBackupCodeBinaryBlob, index: number): Uint8Array {
    const offset = SALT_SIZE + (index * HASH_SIZE);
    return blob.slice(offset, offset + HASH_SIZE);
  }

  /**
   * Get the number of hashes stored in a binary blob
   */
  private static getHashCount(blob: IBackupCodeBinaryBlob): number {
    return Math.floor((blob.length - SALT_SIZE) / HASH_SIZE);
  }

  /**
   * Serialize binary blob for storage (encrypt only, returns raw bytes)
   * @param binaryBlob The binary blob containing salt + hashes
   * @returns Encrypted Uint8Array for direct bytea storage
   */
  static async serializeBackUpCodesForStorage(
    binaryBlob: IBackupCodeBinaryBlob,
  ): Promise<Uint8Array> {
    try {
      const encryptedData = await useSymmetricEncrypt({
        key: this.config.encryptionKey,
        data: binaryBlob,
      }) as Uint8Array;

      return encryptedData;
    } catch (error) {
      throw new Error(
        `Failed to serialize backup codes: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Deserialize binary blob from storage (decrypt only, accepts raw bytes)
   * @param encryptedBlob Encrypted Uint8Array from bytea column
   * @returns Decrypted binary blob containing salt + hashes
   */
  static async deserializeBackUpCodes(
    encryptedBlob: Uint8Array,
  ): Promise<IBackupCodeBinaryBlob> {
    try {
      const decryptedData = await useSymmetricDecrypt({
        key: this.config.encryptionKey,
        data: encryptedBlob,
      }) as Uint8Array;

      return decryptedData;
    } catch (error) {
      throw new Error(
        `Failed to deserialize backup codes: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Verify a backup code against stored binary blob
   * @param providedCode The backup code to verify
   * @param encryptedBlob Encrypted binary blob from bytea storage
   * @returns True if the code is valid
   */
  static async verifyBackupCodeAgainstHash(
    providedCode: string,
    encryptedBlob: Uint8Array,
  ): Promise<boolean> {
    const normalizedCode = providedCode.replace(/-/g, "");
    if (normalizedCode.length !== this.config.codeLength) return false;

    const binaryBlob = await this.deserializeBackUpCodes(encryptedBlob);
    const salt = this.extractSalt(binaryBlob);
    const hashCount = this.getHashCount(binaryBlob);

    // Hash the provided code with the shared salt
    const codeData = new TextEncoder().encode(normalizedCode);
    const saltedCode = new Uint8Array(salt.length + codeData.length);
    saltedCode.set(salt);
    saltedCode.set(codeData, salt.length);
    const computedHash = hashData(saltedCode);

    // Compare against each stored hash using constant-time comparison
    for (let i = 0; i < hashCount; i++) {
      const storedHash = this.extractHash(binaryBlob, i);
      if (safeEqual(computedHash, storedHash)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find and remove a matching backup code from the stored binary blob
   * @param providedCode The backup code to find and remove
   * @param encryptedBlob Encrypted binary blob from bytea storage
   * @returns Object with remaining binary blob (for re-serialization) and match status
   */
  static async findAndRemoveBackupCode(
    providedCode: string,
    encryptedBlob: Uint8Array,
  ): Promise<{ remainingBinaryBlob: IBackupCodeBinaryBlob | null; matchFound: boolean }> {
    const normalizedCode = providedCode.replace(/-/g, "");
    if (normalizedCode.length !== this.config.codeLength) {
      return { remainingBinaryBlob: null, matchFound: false };
    }

    const binaryBlob = await this.deserializeBackUpCodes(encryptedBlob);
    const salt = this.extractSalt(binaryBlob);
    const hashCount = this.getHashCount(binaryBlob);

    // Hash the provided code with the shared salt
    const codeData = new TextEncoder().encode(normalizedCode);
    const saltedCode = new Uint8Array(salt.length + codeData.length);
    saltedCode.set(salt);
    saltedCode.set(codeData, salt.length);
    const computedHash = hashData(saltedCode);

    // Find matching hash index
    let matchIndex = -1;
    for (let i = 0; i < hashCount; i++) {
      const storedHash = this.extractHash(binaryBlob, i);
      if (safeEqual(computedHash, storedHash)) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      return { remainingBinaryBlob: binaryBlob, matchFound: false };
    }

    // Build new binary blob without the matched hash
    // Keep the same salt, just remove one 32-byte hash block
    const newHashCount = hashCount - 1;

    if (newHashCount === 0) {
      // No codes remaining - return minimal blob with just salt
      return { remainingBinaryBlob: salt, matchFound: true };
    }

    const newTotalSize = SALT_SIZE + (newHashCount * HASH_SIZE);
    const newBlob = new Uint8Array(newTotalSize);

    // Copy salt
    newBlob.set(salt, 0);

    // Copy all hashes except the matched one
    let writeOffset = SALT_SIZE;
    for (let i = 0; i < hashCount; i++) {
      if (i === matchIndex) continue;
      const hash = this.extractHash(binaryBlob, i);
      newBlob.set(hash, writeOffset);
      writeOffset += HASH_SIZE;
    }

    return { remainingBinaryBlob: newBlob, matchFound: true };
  }
}
