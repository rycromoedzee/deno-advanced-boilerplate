/**
 * @file utils/text/hashing.ts
 * @description Text hashing utilities
 */
import { argon2Hash, Argon2Variant, Argon2Version, blake3, Buffer, bytesToHex, nodeRandomBytes as randomBytes } from "@deps";
import { envConfig } from "@config/env.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

/**
 * Centralised blake3 hashing utilities.
 *
 * All blake3 usage in the codebase goes through these functions so the
 * `@noble/hashes` dependency is isolated to this file. If we ever swap
 * to a different algorithm (e.g. native Web Crypto), only these three
 * functions need to change.
 *
 * Three modes, matching blake3's native capabilities:
 *
 *  • hashWithKey     – keyed hashing (pepper / HMAC-like)
 *  • hashWithContext – domain-separated hashing with a context string
 *  • hashData        – plain hashing (no key, no context)
 *
 * All `data`, `key`, and `context` params accept `string` or `Uint8Array`.
 * Strings are UTF-8 encoded automatically.
 */

type HashInput = string | Uint8Array;

const encoder = new TextEncoder();

function toBytes(input: HashInput): Uint8Array {
  return typeof input === "string" ? encoder.encode(input) : input;
}

/** Keyed blake3 hash — use for pepper / HMAC-like scenarios. */
export function hashWithKey(
  data: HashInput,
  key: HashInput,
  dkLen = 32,
): Uint8Array {
  return blake3(toBytes(data), { key: toBytes(key), dkLen });
}

/** Context-separated blake3 hash — use for domain-separated derivation. */
export function hashWithContext(
  data: HashInput,
  context: HashInput,
  dkLen = 32,
): Uint8Array {
  return blake3(toBytes(data), { context: toBytes(context), dkLen });
}

/** Plain blake3 hash — no key, no context. */
export function hashData(
  data: HashInput,
  dkLen = 32,
): Uint8Array {
  return blake3(toBytes(data), { dkLen });
}

type ArgonConfig = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
};

export const HASHING_CONTEXTS = {
  AUTH_TOKEN_HASH: "auth-token-hash",
  AUTH_RECOVERY_PHRASE_HASH: "auth-recovery-phrase-hash",
  AUTH_REFRESH_TOKEN: "auth-refresh-token",
  AUTH_FINGERPRINT: "auth-fingerprint",
  AUTH_SESSION_ENCRYPTION: "auth-session-encryption",
  AUTH_TWO_FACTOR: "auth-two-factor",

  CACHE_ENCRYPTION_KEY: "cache-encryption-key",

  ENCRPYTION_PASSWORD_DERIVED_SALT: "encryption-password-derived-salt",
  ENCRYPTION_TYPE_FILE: "encryption-type-file",
  ENCRYPTION_TYPE_TEXT: "encryption-type-text",

  PASSKEY_ENCRYPTION: "passkey-encryption",

  PUBLIC_SHARE: "public-share-key",

  MASTER_KEY_ROTATION_ESCROW: "master-key-rotation-escrow",
  TENANT_DB_CREDENTIALS: "tenant-db-credentials",
} as const;

// Type for the actual string values (e.g., "encryption-type-file")
export type IHashingContext = typeof HASHING_CONTEXTS[keyof typeof HASHING_CONTEXTS];

export const PASSWORD_HASHING_CONFIG = {
  STORAGE: {
    memoryCost: 98304, // 96 MiB in KiB
    timeCost: 3, // RFC 9106 minimum
    parallelism: 2, //
    hashLength: 32, // 256-bit output
  },
  // ENCRYPTION config stays as scrypt for key derivation (non-password use)
  ENCRYPTION: {
    memoryCost: 8192, // 96 MiB in KiB
    timeCost: 3, // RFC 9106 minimum
    parallelism: 1, //
    hashLength: 32, // 256-bit output
  },
};

export class TextHashing {
  /**
   * Derives an encryption key from a password using scrypt.
   * Used ONLY for key derivation (ENCRYPTION config) — not for password storage.
   * For password storage, use AuthPasswordService.generatePassword (Argon2id).
   *
   * @param password - The password to derive the key from
   * @param salt - The salt to use
   * @param config - The scrypt config (use PASSWORD_HASHING_CONFIG.ENCRYPTION)
   * @param pepper - Optional pepper; pass empty string to skip
   * @returns The derived key in base64 format (raw `hashLength` bytes, base64-encoded)
   */
  static async deriveEncryptionKeyFromPassword(
    password: string,
    salt: string,
    config: ArgonConfig,
    pepper: string,
  ): Promise<string> {
    const passwordInput = pepper && pepper.length > 0
      ? hashWithKey(password, new Uint8Array(Buffer.from(pepper, "base64")))
      : encoder.encode(password);

    // `@felix/argon2` returns a PHC-encoded string
    // ($argon2id$v=19$m=...,t=...,p=...$<saltB64>$<hashB64>), NOT the raw hash bytes.
    // The raw derived key is the final `$`-delimited segment, encoded as
    // non-padded standard base64. Extract it and return it as padded base64 so
    // that callers decoding with base64 recover exactly `config.hashLength` bytes.
    const phc = await argon2Hash(Buffer.from(passwordInput).toString("base64"), {
      salt: new Uint8Array(Buffer.from(salt, "base64")),
      variant: Argon2Variant.Argon2id,
      version: Argon2Version.V13,
      memoryCost: config.memoryCost,
      timeCost: config.timeCost,
      lanes: config.parallelism,
      hashLength: config.hashLength,
    });

    const rawHashB64 = phc.split("$").pop();
    if (!rawHashB64) {
      throw new Error("Unexpected Argon2 hash format: missing hash segment");
    }

    // Re-encode the raw hash bytes as standard padded base64.
    const rawHash = new Uint8Array(Buffer.from(rawHashB64, "base64"));
    return Buffer.from(rawHash).toString("base64");
  }

  static async hasAuthPassword(password: string) {
    const pepper = envConfig.auth.passwordPepper;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const secret = pepper ? new TextEncoder().encode(pepper) : undefined;

    // Returns PHC string: $argon2id$v=19$m=98304,t=3,p=1$<salt>$<hash>
    return await argon2Hash(password, {
      salt,
      secret,
      variant: Argon2Variant.Argon2id,
      version: Argon2Version.V13,
      memoryCost: PASSWORD_HASHING_CONFIG.STORAGE.memoryCost,
      timeCost: PASSWORD_HASHING_CONFIG.STORAGE.timeCost,
      lanes: PASSWORD_HASHING_CONFIG.STORAGE.parallelism,
      hashLength: PASSWORD_HASHING_CONFIG.STORAGE.hashLength,
    });
  }

  /**
   * Generates a random key with context
   *
   * @param context - The context to use for the key
   * @returns The random key
   */
  static generateKeyFromRandom(dkLen: number = 32, context: string) {
    return hashWithContext(randomBytes(dkLen), context, dkLen);
  }

  /**
   * Generates a hash from a string
   *
   * @param text - The text to hash
   * @param context - The context to use for the hash
   * @returns The hash
   */
  static generateHashFromString(
    text: string,
    context: string,
    dkLen: number = 32,
  ) {
    return hashWithContext(text, context, dkLen);
  }

  /**
   * Generates a hash for encrypted data decryption
   *
   * @param key - The key to use for the encrypted data decryption
   * @param context - The context to use for the encrypted data decryption
   * @returns The hash for encrypted data decryption
   */
  static generateHashFromKeyForEncryption(key: string, context: string) {
    return hashWithContext(new Uint8Array(Buffer.from(key, "base64")), context);
  }

  static generateHashFromKeyForCacheEncryption(key: string) {
    return hashWithContext(new Uint8Array(Buffer.from(key, "base64")), HASHING_CONTEXTS.CACHE_ENCRYPTION_KEY);
  }

  static generateHashFromKeyForAuthRecoveryPhrase(key: string) {
    return bytesToHex(
      hashWithContext(key, HASHING_CONTEXTS.AUTH_RECOVERY_PHRASE_HASH),
    );
  }

  static generateHashFromKeyForAuthTwoFactor(key: string) {
    return hashWithContext(new Uint8Array(Buffer.from(key, "base64")), HASHING_CONTEXTS.AUTH_TWO_FACTOR);
  }

  /**
   * Generates a hash from a Uint8Array key with context
   * Used for deriving encryption keys from raw key material like PRF output
   *
   * @param key - The key as Uint8Array
   * @param context - The context to use for the hash
   * @param dkLen - The derived key length (default 32)
   * @returns The hash as Uint8Array
   */
  static generateHashFromKey(
    key: Uint8Array,
    context: string,
    dkLen: number = 32,
  ): Uint8Array {
    return hashWithContext(key, context, dkLen);
  }
}

/**
 * Default false-positive rate for the common-password blocklist filter.
 * 0.0001 = 0.01% (~1 in 10,000). For 100k entries this is ~240KB of memory,
 * vs ~6-12MB for an in-memory Set of all password strings.
 *
 * A Bloom filter can produce FALSE POSITIVES (flagging a safe password as
 * "common") but never FALSE NEGATIVES (a common password will always be
 * detected). This is the correct trade-off for a blocklist: occasionally
 * asking a user to pick a different password is acceptable; letting a known
 * common password through is not.
 */
const COMMON_PASSWORD_FALSE_POSITIVE_RATE = 0.0001;

/**
 * Self-contained, dependency-free Bloom filter.
 *
 * Membership test with O(k) lookup and a compact bit-array backing store.
 * Uses MurmurHash3 (fast, non-cryptographic) with double-hashing to derive
 * k hash functions. Suitable for static blocklists such as common passwords.
 */
export class BloomFilter {
  private readonly bitArray: Uint32Array;
  private readonly size: number;
  private readonly hashCount: number;

  /**
   * @param expectedElements - Number of items the filter will hold
   * @param falsePositiveRate - Target false-positive probability (0 < p < 1)
   */
  constructor(expectedElements: number, falsePositiveRate: number) {
    const n = Math.max(1, expectedElements);
    this.size = BloomFilter.optimalSize(n, falsePositiveRate);
    this.hashCount = BloomFilter.optimalHashCount(this.size, n);
    this.bitArray = new Uint32Array(Math.ceil(this.size / 32));
  }

  /** Adds an item to the filter. */
  add(item: string): void {
    for (const hash of this.hashes(item)) {
      const index = hash % this.size;
      this.bitArray[index >>> 5] |= 1 << (index & 31);
    }
  }

  /**
   * Returns true if the item is possibly in the set, false if definitely not.
   * False positives are possible; false negatives are not.
   */
  has(item: string): boolean {
    for (const hash of this.hashes(item)) {
      const index = hash % this.size;
      if ((this.bitArray[index >>> 5] & (1 << (index & 31))) === 0) {
        return false;
      }
    }
    return true;
  }

  /** Approximate memory footprint of the bit array in KB. */
  get memoryKB(): number {
    return Math.ceil((this.bitArray.length * 4) / 1024);
  }

  private hashes(item: string): number[] {
    const h1 = BloomFilter.murmurHash3(item, 0);
    // Force odd so it is coprime with the (even) size, improving distribution.
    const h2 = BloomFilter.murmurHash3(item, 1) | 1;

    const out: number[] = new Array(this.hashCount);
    for (let i = 0; i < this.hashCount; i++) {
      // >>> 0 keeps the combined hash an unsigned 32-bit integer.
      out[i] = (h1 + Math.imul(i, h2)) >>> 0;
    }
    return out;
  }

  private static murmurHash3(key: string, seed: number): number {
    let h1 = seed;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    const length = key.length;

    for (let i = 0; i < length; i++) {
      let k1 = key.charCodeAt(i);
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);

      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = Math.imul(h1, 5) + 0xe6546b64;
    }

    h1 ^= length;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
  }

  private static optimalSize(n: number, p: number): number {
    const size = Math.ceil(-(n * Math.log(p)) / (Math.log(2) ** 2));
    // Round up to a multiple of 32 to fully use each Uint32 cell.
    return Math.max(32, Math.ceil(size / 32) * 32);
  }

  private static optimalHashCount(size: number, n: number): number {
    const k = Math.round((size / n) * Math.log(2));
    return Math.max(1, Math.min(10, k));
  }
}

/**
 * Lazily-built Bloom filter of common/breached passwords, loaded from
 * `libs/passwords.json` (a JSON array of strings).
 *
 * The filter is built once on first use and cached for the process lifetime.
 * Lookups are case-insensitive (entries and queries are lowercased).
 *
 * Data-source seam: the password list is read via {@link CommonPasswordFilter.dataSource},
 * which defaults to a loader that resolves `libs/passwords.json` relative to THIS
 * module (using `import.meta.url`), NOT relative to the process CWD. This keeps
 * the load stable regardless of the working directory. Tests / alternate
 * deployments can override the source before first use via {@link CommonPasswordFilter.withDataSource}.
 */
export class CommonPasswordFilter {
  private static filter: BloomFilter | null = null;
  private static building: Promise<BloomFilter> | null = null;

  /**
   * Resolves the default blocklist path relative to this module file
   * (`utils/text/hashing.ts` -> `../../libs/passwords.json`), independent of the
   * process working directory. Equivalent to `./libs/passwords.json` only when
   * CWD is the repo root.
   */
  private static readonly DEFAULT_SOURCE_URL = new URL(
    "../../libs/passwords.json",
    import.meta.url,
  );

  /**
   * Injectable data source. Returns the raw JSON text of the password list.
   * Override via {@link CommonPasswordFilter.withDataSource} for tests/fixtures.
   */
  private static dataSource: () => Promise<string> = () => Deno.readTextFile(CommonPasswordFilter.DEFAULT_SOURCE_URL);

  /**
   * Override the blocklist data source. Must be called BEFORE the first
   * `isCommon` / `warmUp` (the filter is built lazily and cached for the process
   * lifetime). Intended for tests that inject a fixture; production leaves the
   * default (module-relative `libs/passwords.json`).
   *
   * @param loader - async function returning the raw JSON text of the list
   */
  static withDataSource(loader: () => Promise<string>): void {
    this.dataSource = loader;
    // Reset any in-flight / cached state so the new source takes effect.
    this.filter = null;
    this.building = null;
  }

  /**
   * Returns true if the password appears in the common-password blocklist.
   * Returns false (fail-open) if the blocklist could not be loaded, so that a
   * loading problem never blocks all password changes — the caller's schema
   * validation still enforces strength requirements.
   */
  static async isCommon(password: string): Promise<boolean> {
    const filter = await this.getFilter();
    if (!filter) return false;
    return filter.has(password.toLowerCase());
  }

  /**
   * Eagerly builds the filter. Call during startup to avoid paying the
   * build cost on the first password validation. Safe to call multiple times.
   */
  static async warmUp(): Promise<void> {
    await this.getFilter();
  }

  private static async getFilter(): Promise<BloomFilter | null> {
    if (this.filter) return this.filter;
    if (this.building) return this.building;

    this.building = this.build();
    try {
      this.filter = await this.building;
      return this.filter;
    } catch {
      // Swallow here; build() already logs. Reset so a later call can retry.
      this.building = null;
      return null;
    } finally {
      this.building = null;
    }
  }

  private static async build(): Promise<BloomFilter> {
    try {
      const data = await this.dataSource();
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        throw new Error("Invalid common passwords format: expected an array");
      }

      const filter = new BloomFilter(parsed.length, COMMON_PASSWORD_FALSE_POSITIVE_RATE);
      for (const entry of parsed) {
        if (typeof entry === "string") {
          filter.add(entry.toLowerCase());
        }
      }
      return filter;
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "Failed to load common passwords blocklist",
        messageKey: "auth.common_passwords_load_failed",
        section: loggerAppSections.AUTH,
        raw: error instanceof Error ? { message: error.message } : { error: "Unknown error" },
      });
      throw error;
    }
  }
}
