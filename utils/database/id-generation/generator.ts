/**
 * @file utils/database/id-generation/generator.ts
 * @description ID generator implementations
 */
import { randomBytes, sha256 } from "@deps";
import { getInstanceId } from "@utils/instance-id.ts";

const TEXT_ENCODER = new TextEncoder();

/* ========================================================================== */
/*                           INTERNAL USE NOTICE                             */
/* ========================================================================== */
/**
 * WARNING: The generate/create functions in this file are intended for INTERNAL USE ONLY.
 *
 * Do NOT invoke the following functions directly from other parts of the codebase:
 * - generateCuid2()
 * - generateRandomId()
 * - createNanoidGenerator()
 *
 * Instead, use the specialized functions from:
 * - common.ts (generateIdRandomWithTimestamp, generateIdRandom)
 * - documents.ts (generateIdForDocument, generateIdForDocumentFolder, generateIdForDocumentTag)
 * - iam.ts (generateIdForUser, generateIdForEnvironment)
 * - storage.ts (generateIdForStorage)
 *
 * This prevents improper usage and maintains code integrity by ensuring consistent
 * ID generation patterns across the application.
 */

/* ========================================================================== */
/*                           CHARACTER SETS                                  */
/* ========================================================================== */

/** Character sets for ID generation */
export const GenerateIdCharacters = Object.freeze({
  /** Standard nanoid alphabet: URL-safe base64 characters */
  URL_SAFE: "_-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  /** Lowercase letters and numbers */
  LOWER_NUMBERS: "0123456789abcdefghijklmnopqrstuvwxyz",
  /** Mixed case letters and numbers */
  LOWER_UPPER_NUMBERS: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  /** Lowercase letters only */
  LOWER: "abcdefghijklmnopqrstuvwxyz",
  /** Uppercase letters only */
  UPPER: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  /** Numbers only */
  NUMBERS: "0123456789",
  /** All alphanumeric plus underscore */
  ALL: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz",
});

/* ========================================================================== */
/*                           CUID2 IMPLEMENTATION                            */
/* ========================================================================== */

/** CUID2 character sets */
const CUID2_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const CUID2_ALPHA = "abcdefghijklmnopqrstuvwxyz";

/** Generate random bytes for CUID2 */
function cuid2Rand(n: number): Uint8Array {
  return randomBytes(n);
}

/** Generate a random alphabetic character for CUID2 */
function cuid2RandomAlpha(): string {
  // Rejection sample to avoid modulo bias: 256 % 26 = 22 leftover bytes would
  // make a-v slightly more likely than w-z. Reject b >= 234 (= 256 - 22).
  let b: number;
  do {
    b = cuid2Rand(1)[0];
  } while (b >= 234);
  return CUID2_ALPHA[b % 26];
}

/** Convert digest bytes to base36 string for CUID2 */
function cuid2DigestToBase36(bytes: Uint8Array, count: number): string {
  let out = "";
  let i = 0;
  while (out.length < count) {
    if (i >= bytes.length) {
      bytes = sha256(bytes);
      i = 0;
    }
    const b = bytes[i++];
    if (b < 252) out += CUID2_BASE36[b % 36];
  }
  return out;
}

/** CUID2 factory class for generating collision-resistant IDs */
class Cuid2Factory {
  private counter = 0;
  private counterOverflowCount = 0;
  private fpCache: string | null = null;
  private fpCacheTime = 0;
  private readonly FP_CACHE_TTL = 3_600_000; // 1 hour

  constructor(
    private readonly minLen = 6,
    private readonly maxLen = 128,
  ) {}

  next(length = this.minLen): string {
    if (
      !Number.isInteger(length) || length < this.minLen || length > this.maxLen
    ) {
      throw new Error(
        `Length must be between ${this.minLen} and ${this.maxLen}`,
      );
    }

    this.counter = (this.counter + 1) & 0xffffff;
    if (this.counter === 0) this.counterOverflowCount++;

    const first = cuid2RandomAlpha();
    const header = TEXT_ENCODER.encode(
      `${Date.now().toString(36)}:${this.cuid2Fingerprint()}`,
    );
    const rand = cuid2Rand(13);

    const payload = new Uint8Array(header.length + 3 + rand.length);
    payload.set(header, 0);
    payload[header.length] = this.counter & 0xff;
    payload[header.length + 1] = (this.counter >>> 8) & 0xff;
    payload[header.length + 2] = (this.counter >>> 16) & 0xff;
    payload.set(rand, header.length + 3);

    const digest = sha256(payload);
    const body = cuid2DigestToBase36(digest, length - 1);
    return first + body;
  }

  private cuid2Fingerprint(): string {
    const now = Date.now();
    if (this.fpCache && (now - this.fpCacheTime) < this.FP_CACHE_TTL) {
      return this.fpCache;
    }
    const salt = cuid2Rand(16);

    const data = TEXT_ENCODER.encode(
      [
        crypto.randomUUID?.() ??
          Array.from(cuid2Rand(16)).map((b) => b.toString(16).padStart(2, "0")).join(""),
        Date.now(),
        getInstanceId(),
        this.counterOverflowCount,
      ].join(":"),
    );

    const fpInput = new Uint8Array(data.length + salt.length);
    fpInput.set(data, 0);
    fpInput.set(salt, data.length);

    const fp = sha256(fpInput).slice(0, 16);
    this.fpCache = cuid2DigestToBase36(fp, 16);
    this.fpCacheTime = now;
    return this.fpCache;
  }

  cuid2ClearCache(): void {
    this.fpCache = null;
    this.fpCacheTime = 0;
  }
}

/** Default CUID2 factory instance */
const cuid2DefaultFactory = new Cuid2Factory();

/* ========================================================================== */
/*                           NANOID IMPLEMENTATION                           */
/* ========================================================================== */
// Based on https://github.com/ai/nanoid/blob/main/index.js
// Adapted for Deno with native crypto APIs

/** NanoID random byte pool configuration */
const NANOID_POOL_SIZE_MULTIPLIER = 128;
let nanoidPool: Uint8Array | undefined;
let nanoidPoolOffset = 0;

/**
 * Fills the NanoID random byte pool with fresh entropy.
 * @param bytes The number of bytes needed.
 */
function nanoidFillPool(bytes: number): void {
  if (!nanoidPool || nanoidPool.length < bytes) {
    nanoidPool = new Uint8Array(bytes * NANOID_POOL_SIZE_MULTIPLIER);
    crypto.getRandomValues(nanoidPool);
    nanoidPoolOffset = 0;
  } else if (nanoidPoolOffset + bytes > nanoidPool.length) {
    crypto.getRandomValues(nanoidPool);
    nanoidPoolOffset = 0;
  }
  nanoidPoolOffset += bytes;
}

/**
 * Generates random bytes from the NanoID pool.
 * @param bytes The number of random bytes to generate.
 * @returns A Uint8Array containing random bytes.
 */
function nanoidRandom(bytes: number): Uint8Array {
  bytes |= 0; // Ensure bytes is a number (prevents valueOf abuse and pool pollution)
  nanoidFillPool(bytes);
  return nanoidPool!.subarray(nanoidPoolOffset - bytes, nanoidPoolOffset);
}

/**
 * @deprecated INTERNAL USE ONLY - Do not call directly from other parts of the codebase
 *
 * Creates a NanoID generator function with specified alphabet and default size.
 * This is useful when you need multiple ID generators with different configurations.
 *
 * ⚠️ WARNING: This function is for internal use only. Use the specialized functions instead:
 * - For general use: generateIdRandom() from common.ts
 * - For documents: generateIdForDocument() from documents.ts
 * - For users: generateIdForUser() from iam.ts
 * - For storage: generateIdForStorage() from storage.ts
 *
 * @param alphabet A string containing the characters to use for ID generation.
 * @param defaultSize The default length of the generated IDs.
 * @returns A function that generates random IDs.
 *
 * @example
 * ```ts
 * const generateShortId = createNanoidGenerator(GenerateIdCharacters.LOWER_NUMBERS, 8);
 * const id = generateShortId(); // Generates an 8-character ID
 * const longerId = generateShortId(16); // Generates a 16-character ID
 * ```
 */
function createNanoidGenerator(
  alphabet: string = GenerateIdCharacters.URL_SAFE,
  defaultSize: number = 21, // Align with official NanoID default for better collision resistance
) {
  if (alphabet.length < 2) throw new Error("Alphabet must have at least 2 unique characters");
  if (defaultSize < 1) throw new Error("Default size must be at least 1");

  // Largest byte value that maps uniformly across the alphabet. Bytes in
  // [safeByteCutoff, 256) would introduce modulo bias and are rejected.
  // See https://github.com/ai/nanoid/pull/582 — this replaces the older
  // power-of-two mask approach with tighter byte-range usage.
  const safeByteCutoff = 256 - (256 % alphabet.length);

  // Power-of-two alphabets: every byte maps cleanly via bitmask, no rejection
  // needed and step === size.
  if (safeByteCutoff === 256) {
    const mask = alphabet.length - 1;
    return (size = defaultSize): string => {
      if (size < 1) throw new Error("Size must be at least 1");
      let id = "";
      while (true) {
        const bytes = nanoidRandom(size);
        let i = size;
        while (i--) {
          id += alphabet[bytes[i] & mask];
          if (id.length >= size) return id;
        }
      }
    };
  }

  // Non-power-of-two: request extra bytes up front to cover expected rejections.
  // 1.6 is the upstream-tuned magic constant.
  const step = Math.ceil((1.6 * 256 * defaultSize) / safeByteCutoff);

  return (size = defaultSize): string => {
    if (size < 1) throw new Error("Size must be at least 1");
    let id = "";
    while (true) {
      const bytes = nanoidRandom(step);
      let i = step;
      while (i--) {
        if (bytes[i] < safeByteCutoff) {
          id += alphabet[bytes[i] % alphabet.length];
          if (id.length >= size) return id;
        }
      }
    }
  };
}

/** Memoised generators keyed by `${length}:${alphabet}` — avoids rebuilding the
 * mask/step closures on every ID generation. */
const nanoidGeneratorCache = new Map<string, (size?: number) => string>();

function getCachedNanoidGenerator(
  alphabet: string,
  length: number,
): (size?: number) => string {
  const key = `${length}:${alphabet}`;
  let generator = nanoidGeneratorCache.get(key);
  if (!generator) {
    generator = createNanoidGenerator(alphabet, length);
    nanoidGeneratorCache.set(key, generator);
  }
  return generator;
}

/**
 * Simple helper to generate a NanoID with specified alphabet and length.
 * Ensures the last character is alphanumeric (no "-" or "_") for aesthetics.
 * @param alphabet Character set to use
 * @param length Length of the ID to generate
 * @returns Generated ID string
 */
function generateNanoid(alphabet: string, length: number): string {
  const generator = getCachedNanoidGenerator(alphabet, length);

  if (!alphabet.includes("-") && !alphabet.includes("_")) {
    return generator();
  }

  const alphanumericOnly = alphabet.replace(/[-_]/g, "");
  if (alphanumericOnly.length === 0) {
    return generator();
  }

  const id = generator();
  const lastIdx = length - 1;
  if (id[lastIdx] === "-" || id[lastIdx] === "_") {
    const singleCharGenerator = getCachedNanoidGenerator(alphanumericOnly, 1);
    return id.slice(0, lastIdx) + singleCharGenerator();
  }

  return id;
}

/* ========================================================================== */
/*                           PUBLIC API - CUID2                             */
/* ========================================================================== */

/**
 * @deprecated INTERNAL USE ONLY - Do not call directly from other parts of the codebase
 *
 * Generates a new CUID2 (Collision-resistant Unique Identifier v2) string.
 * CUID2 provides better collision resistance than NanoID by including timestamp,
 * fingerprint, and counter data, making it ideal for distributed systems.
 *
 * ⚠️ WARNING: This function is for internal use only. Use the specialized functions instead:
 * - For general use: generateIdRandomWithTimestamp() from common.ts
 * - For documents: generateIdForDocument() from documents.ts
 * - For users: generateIdForUser() from iam.ts
 * - For storage: generateIdForStorage() from storage.ts
 *
 * @param length - The desired length of the generated ID (default: 24 characters)
 *   - Minimum length: 6 characters
 *   - Maximum length: 128 characters
 *   - Recommended range: 12-32 characters for optimal performance
 * @returns A CUID2 string containing:
 *   - First character: lowercase letter (a-z)
 *   - Remaining characters: base36 alphanumeric (0-9, a-z)
 *   - Includes timestamp, fingerprint, and random data for uniqueness
 *
 * @example
 * ```ts
 * const id = generateCuid2(); // "a7b2c9d4e8f1g5h3i6j0k2l9m4"
 * const shortId = generateCuid2(12); // "a7b2c9d4e8f1"
 * ```
 *
 * @throws {Error} When length is outside the valid range (6-128)
 */
export function generateCuid2(length: number = 24): string {
  return cuid2DefaultFactory.next(length);
}

/**
 * Validates whether the given string is a valid CUID2 format.
 * CUID2 validation checks for proper structure: starts with lowercase letter,
 * followed by base36 alphanumeric characters, within valid length bounds.
 *
 * @param id - The string to validate (can be any type)
 * @returns `true` if the id is a valid CUID2 string, `false` otherwise
 *
 * @example
 * ```ts
 * isValidCuid2("a7b2c9d4e8f1g5h3i6j0k2l9m4"); // true
 * isValidCuid2("A7b2c9d4e8f1g5h3i6j0k2l9m4"); // false (starts with uppercase)
 * isValidCuid2("a7b2c9d4e8f1g5h3i6j0k2l9m4@"); // false (contains invalid character)
 * isValidCuid2("a"); // false (too short)
 * isValidCuid2(123); // false (not a string)
 * ```
 */
export function isValidCuid2(id: unknown): id is string {
  return typeof id === "string" &&
    id.length >= 6 &&
    id.length <= 128 &&
    /^[a-z][0-9a-z]+$/.test(id);
}

/**
 * Clears the cached fingerprint for the default CUID2 factory instance.
 * CUID2 uses a cached fingerprint (based on hostname, PID, etc.) for uniqueness.
 * Clearing the cache forces regeneration of the fingerprint, which is useful
 * for testing scenarios where you need predictable ID generation.
 *
 * @example
 * ```ts
 * // In tests, clear cache to ensure consistent fingerprint
 * cuid2ClearFingerprintCache();
 * const id1 = generateCuid2();
 * const id2 = generateCuid2();
 * // Both IDs will have the same fingerprint component
 * ```
 */
export function cuid2ClearFingerprintCache(): void {
  cuid2DefaultFactory.cuid2ClearCache();
}

/* ========================================================================== */
/*                           PUBLIC API - NANOID                            */
/* ========================================================================== */

/**
 * @deprecated INTERNAL USE ONLY - Do not call directly from other parts of the codebase
 *
 * Generates a random ID with customizable length and character set using NanoID.
 * Uses URL-safe characters by default for maximum compatibility across systems.
 * NanoID provides fast generation with good collision resistance using
 * cryptographically secure random number generation.
 *
 * ⚠️ WARNING: This function is for internal use only. Use the specialized functions instead:
 * - For general use: generateIdRandom() from common.ts
 * - For documents: generateIdForDocument() from documents.ts
 * - For users: generateIdForUser() from iam.ts
 * - For storage: generateIdForStorage() from storage.ts
 *
 * @param length - The desired length of the ID (default: 21 characters)
 *   - Minimum length: 1 character
 *   - Maximum length: 255 characters (practical limit)
 *   - Recommended range: 8-32 characters for optimal performance
 * @param alphabet - Character set to use for ID generation (default: URL_SAFE)
 *   - URL_SAFE: A-Z, a-z, 0-9, _, - (default)
 *   - LOWER_NUMBERS: 0-9, a-z
 *   - ALL: A-Z, a-z, 0-9, _
 *   - Custom alphabet (must have at least 2 unique characters)
 * @returns A random ID string using the specified character set
 *
 * @example
 * ```ts
 * const id = generateRandomId(); // "V1StGXR8_Z5jdHi6B-myT4Kz"
 * const shortId = generateRandomId(8); // "V1StGXR8"
 * const numericId = generateRandomId(12, GenerateIdCharacters.NUMBERS); // "123456789012"
 * ```
 *
 * @throws {Error} When length is less than 1 or alphabet has fewer than 2 characters
 */
export function generateRandomId(length: number = 21, alphabet: string = GenerateIdCharacters.URL_SAFE): string {
  return generateNanoid(alphabet, length);
}

/**
 * Validates whether the given string is a valid NanoID format.
 * NanoID validation checks for URL-safe characters (A-Z, a-z, 0-9, _, -)
 * and reasonable length bounds. This is a best-effort validation since
 * NanoID can use custom alphabets, but this validates the default URL-safe format.
 *
 * @param id - The string to validate (can be any type)
 * @returns `true` if the id appears to be a valid NanoID string, `false` otherwise
 *
 * @example
 * ```ts
 * isValidNanoId("V1StGXR8_Z5jdHi6B-myT4Kz"); // true
 * isValidNanoId("abc123def456"); // true
 * isValidNanoId("V1StGXR8_Z5jdHi6B@myT4Kz"); // false (contains @)
 * isValidNanoId(""); // false (empty string)
 * isValidNanoId(123); // false (not a string)
 * ```
 */
export function isValidNanoId(id: unknown): id is string {
  return typeof id === "string" &&
    id.length >= 1 &&
    id.length <= 255 && // Reasonable upper bound
    /^[A-Za-z0-9_-]+$/.test(id);
}
