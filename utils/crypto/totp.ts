/**
 * @file utils/crypto/totp.ts
 * @description TOTP (time-based OTP) generation/verification
 */
/**
 * TOTP (Time-based One-Time Password) Generation Utilities
 *
 * This module provides utilities for generating and validating TOTP codes,
 * commonly used in two-factor authentication (2FA) systems.
 */

import { hmac, sha1 } from "@deps";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "@services/encryption/index.ts";
import { TextHashing } from "@utils/text/index.ts";
import { envConfig } from "@config/env.ts";

/** Write a big-endian uint64 into a byte buffer. */
function putUint64BE(buf: Uint8Array, value: number, offset = 0): void {
  // Use BigInt: JS bitwise operators coerce to signed 32-bit, which truncates
  // the counter to 32 bits and wraps the shift amount modulo 32, corrupting the
  // high 4 bytes of the counter and producing non-RFC-6238 TOTP codes.
  let v = BigInt(value);
  for (let i = 7; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/** Read a big-endian uint32 from a byte buffer. */
function readUint32BE(buf: Uint8Array, offset = 0): number {
  return (
    (buf[offset]! << 24) |
    (buf[offset + 1]! << 16) |
    (buf[offset + 2]! << 8) |
    buf[offset + 3]!
  ) >>> 0;
}

/**
 * TOTP Configuration interface
 */
export interface TOTPConfig {
  intervalSeconds?: number;
  digits?: number;
  encryptionKey?: Uint8Array;
}

/**
 * Default TOTP configuration
 */
const DEFAULT_TOTP_CONFIG: Required<TOTPConfig> = {
  intervalSeconds: 30,
  digits: 6,
  encryptionKey: TextHashing.generateHashFromKeyForAuthTwoFactor(
    envConfig.auth.generalEncryptionKey!,
  ),
};

/**
 * TOTP Generation Service
 *
 * Provides methods for generating TOTP codes from encrypted secrets
 */
export class TOTPGenerationService {
  private static config: Required<TOTPConfig> = DEFAULT_TOTP_CONFIG;

  /**
   * Configure TOTP generation parameters
   * @param config Configuration options
   */
  static configure(config: TOTPConfig): void {
    this.config = { ...DEFAULT_TOTP_CONFIG, ...config };
  }

  /**
   * Get current configuration
   * @returns Current TOTP configuration
   */
  static getConfig(): Required<TOTPConfig> {
    return { ...this.config };
  }

  /**
   * Encrypt a TOTP secret for storage
   * @param secret The secret to encrypt
   * @returns Encrypted secret as Uint8Array
   */
  static async encryptSecret(secret: Uint8Array): Promise<Uint8Array> {
    return await useSymmetricEncrypt({
      key: this.config.encryptionKey,
      data: secret,
    });
  }

  /**
   * Decrypt a TOTP secret for use
   * @param encryptedSecret The encrypted secret to decrypt
   * @returns Decrypted secret as Uint8Array
   */
  static async decryptSecret(encryptedSecret: Uint8Array): Promise<Uint8Array> {
    return await useSymmetricDecrypt({
      key: this.config.encryptionKey,
      data: encryptedSecret,
    });
  }

  /**
   * Generate a TOTP code from an encrypted secret
   * @param encryptedKey The encrypted TOTP secret
   * @param timestamp Optional timestamp (defaults to current time)
   * @returns TOTP code as string
   */
  static async generateTOTP(
    encryptedKey: Uint8Array,
    timestamp: number = Date.now(),
  ): Promise<string> {
    // Calculate time-based counter
    const counter = Math.floor(timestamp / (this.config.intervalSeconds * 1000));

    // Convert counter to bytes
    const counterBytes = new Uint8Array(8);
    putUint64BE(counterBytes, Number(counter), 0);

    const decryptedKey = await useSymmetricDecrypt({
      key: this.config.encryptionKey,
      data: encryptedKey,
    });

    // Generate HMAC-SHA1
    const HS = hmac(sha1, decryptedKey, counterBytes);

    // Dynamic Truncation
    const offset = HS[HS.byteLength - 1]! & 0x0f;
    const truncated = HS.slice(offset, offset + 4);
    truncated[0]! &= 0x7f;

    // Generate OTP
    const SNum = readUint32BE(truncated, 0);
    const D = SNum % 10 ** this.config.digits;

    return D.toString().padStart(this.config.digits, "0");
  }

  /**
   * Generate multiple TOTP codes for testing purposes
   * @param encryptedKey The encrypted TOTP secret
   * @param timestamp Optional timestamp (defaults to current time)
   * @param windowSize Number of intervals before and after to generate
   * @returns Array of TOTP codes with their timestamps
   */
  static async generateTOTPWindow(
    encryptedKey: Uint8Array,
    timestamp: number = Date.now(),
    windowSize: number = 1,
  ): Promise<Array<{ code: string; timestamp: number; interval: number }>> {
    const results: Array<{ code: string; timestamp: number; interval: number }> = [];

    for (let i = -windowSize; i <= windowSize; i++) {
      const timeToCheck = timestamp + (i * this.config.intervalSeconds * 1000);
      const code = await this.generateTOTP(encryptedKey, timeToCheck);
      results.push({
        code,
        timestamp: timeToCheck,
        interval: Math.floor(timeToCheck / (this.config.intervalSeconds * 1000)),
      });
    }

    return results;
  }

  /**
   * Verify a TOTP code against an encrypted secret
   * @param encryptedKey The encrypted TOTP secret
   * @param providedCode The TOTP code to verify
   * @param timestamp Optional timestamp (defaults to current time)
   * @param windowSize Number of intervals before and after to check
   * @returns True if the code is valid within the window
   */
  static async verifyTOTP(
    encryptedKey: Uint8Array,
    providedCode: string,
    timestamp: number = Date.now(),
    windowSize: number = 1,
  ): Promise<boolean> {
    const codes = await this.generateTOTPWindow(encryptedKey, timestamp, windowSize);
    return codes.some(({ code }) => code === providedCode);
  }
}
