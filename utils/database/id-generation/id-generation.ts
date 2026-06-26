/**
 * @file utils/database/id-generation/id-generation.ts
 * @description ID generation strategy entry
 */
import { generateCuid2, GenerateIdCharacters, generateRandomId } from "./generator.ts";

/* ========================================================================== */
/*                            ID POLICY (single source)                      */
/* ========================================================================== */
/**
 * ID POLICY — the ONE place that encodes the engine, length, and alphabet each
 * domain entity receives.
 *
 * Every fixed-policy `generateIdFor<Entity>()` below is a thin typed delegate
 * over {@link generateId}, which reads this map. Adding or changing an entity's
 * ID shape means editing ONE entry here — not hunting through per-entity files.
 *
 * INVARIANT: an entity's `(engine, length, alphabet)` triple must never change
 * silently. DB column constraints, existing-data compatibility, and URL formats
 * depend on these exact values. Transcribe precisely.
 *
 * Engines:
 *   - `cuid2`  → time-ordered, collision-resistant (ignores `alphabet`; CUID2
 *                is always base36 with a lowercase-alpha first char).
 *   - `nanoid` → cryptographically-random, honours `alphabet`.
 */

/** ID engines backed by {@link ./generator.ts}. */
export type IdEngine = "cuid2" | "nanoid";

/** Logical keys for the fixed-policy ID map. */
export type IdEntity =
  | "document"
  | "documentFolder"
  | "documentTag"
  | "user"
  | "environment"
  | "storage"
  | "note"
  | "noteCollection"
  | "noteVersion"
  | "noteTag";

/** Policy for a single entity's ID generation. */
export interface IdPolicy {
  /** Underlying generator to use. */
  engine: IdEngine;
  /** Exact character length of the produced ID. */
  length: number;
  /** Alphabet — only consulted by the `nanoid` engine. */
  alphabet?: string;
}

/**
 * The fixed-policy ID map. Each entry reproduces — byte-for-byte — what the
 * corresponding `generateIdFor<Entity>()` produced before consolidation:
 *
 * Collision domain matters here. Two entities live in the GLOBAL database, so
 * their IDs must stay unique across EVERY tenant: `environment` (the tenant id
 * itself) and the global `user` record. Their lengths are deliberately left
 * untouched. All other entities are TENANT-SCOPED — their IDs only need to be
 * unique within a single tenant DB.
 *
 * The standardization rule is: cap tenant-scoped IDs at 12 — bring the
 * previously over-long ones DOWN to 12, but never inflate an already-shorter
 * ID. At 12 chars collision probability is negligible (~1e-10 at 1M rows/tenant
 * for nanoid; far safer for the time-ordered cuid2 entities). Two low-cardinality
 * entities were already at 10 and stay there: `noteCollection` (few collections
 * per tenant) and `noteTag` (small per-user tag set) — growing them would add
 * length for no benefit.
 *
 * `storage` is the one tenant-scoped exception: it stays at 32 high-entropy
 * chars because its IDs double as file-/object-store keys that may travel
 * beyond a single tenant DB.
 *
 * | entity          | scope   | engine  | length | alphabet              |
 * |-----------------|---------|---------|--------|-----------------------|
 * | document        | tenant  | nanoid  |     12 | LOWER_UPPER_NUMBERS   |
 * | documentFolder  | tenant  | nanoid  |     12 | LOWER_UPPER_NUMBERS   |
 * | documentTag     | tenant  | nanoid  |     12 | LOWER_UPPER_NUMBERS   |
 * | user            | global  | nanoid  |     16 | LOWER_UPPER_NUMBERS   |
 * | environment     | global  | nanoid  |     11 | LOWER_UPPER_NUMBERS   |
 * | storage         | tenant  | nanoid  |     32 | ALL                   |
 * | note            | tenant  | cuid2   |     12 | — (base36)            |
 * | noteCollection  | tenant  | cuid2   |     10 | — (base36)            |
 * | noteVersion     | tenant  | cuid2   |     12 | — (base36)            |
 * | noteTag         | tenant  | nanoid  |     10 | URL_SAFE              |
 */
export const ID_POLICY: Readonly<Record<IdEntity, IdPolicy>> = Object.freeze({
  // Tenant-scoped: capped at 12 (brought down from larger values).
  document: { engine: "nanoid", length: 12, alphabet: GenerateIdCharacters.LOWER_UPPER_NUMBERS },
  documentFolder: { engine: "nanoid", length: 12, alphabet: GenerateIdCharacters.LOWER_UPPER_NUMBERS },
  documentTag: { engine: "nanoid", length: 12, alphabet: GenerateIdCharacters.LOWER_UPPER_NUMBERS },
  // Global-scoped: must be unique across ALL tenants → lengths left unchanged.
  user: { engine: "nanoid", length: 16, alphabet: GenerateIdCharacters.LOWER_UPPER_NUMBERS },
  environment: { engine: "nanoid", length: 11, alphabet: GenerateIdCharacters.LOWER_UPPER_NUMBERS },
  // Tenant-scoped exception: IDs double as cross-system storage keys → stay 32.
  storage: { engine: "nanoid", length: 32, alphabet: GenerateIdCharacters.ALL },
  // Tenant-scoped notes family: capped at 12; the already-short low-cardinality
  // ones (noteCollection, noteTag) stay at 10 — never inflated.
  note: { engine: "cuid2", length: 12 },
  noteCollection: { engine: "cuid2", length: 10 },
  noteVersion: { engine: "cuid2", length: 12 },
  noteTag: { engine: "nanoid", length: 10, alphabet: GenerateIdCharacters.URL_SAFE },
});

/* ========================================================================== */
/*                            CONFIG-DRIVEN CORE                             */
/* ========================================================================== */

/**
 * Generates an ID for a fixed-policy {@link IdEntity}, driven entirely by
 * {@link ID_POLICY}. This is the single core behind every typed per-entity
 * delegate below.
 *
 * @param entity - Logical entity key whose policy should be applied.
 * @returns An ID matching the entity's configured engine + length + alphabet.
 */
export function generateId(entity: IdEntity): string {
  const policy = ID_POLICY[entity];
  if (policy.engine === "cuid2") {
    return generateCuid2(policy.length);
  }
  return generateRandomId(policy.length, policy.alphabet);
}

/* ========================================================================== */
/*                  TYPED PER-ENTITY DELEGATES (public API)                  */
/* ========================================================================== */
// These preserve the pre-consolidation public surface so every caller compiles
// unchanged. Each delegates to `generateId(entity)`, guaranteeing identical
// engine + length + alphabet output. Do NOT inline raw engine calls here —
// route through `generateId` so the policy stays the single source of truth.

/* ---------------------------- documents ---------------------------------- */

/**
 * Generates a unique ID for document records using NanoID.
 * Tenant-scoped, so a uniform 12-char length is used (see {@link ID_POLICY}).
 *
 * @returns A 12-character NanoID string
 */
export function generateIdForDocument(): string {
  return generateId("document");
}

/**
 * Generates a unique ID for document folder records using NanoID.
 * Tenant-scoped, so a uniform 12-char length is used (see {@link ID_POLICY}).
 *
 * @returns A 12-character NanoID string
 */
export function generateIdForDocumentFolder(): string {
  return generateId("documentFolder");
}

/**
 * Generates a unique ID for document tag records using NanoID.
 * Tenant-scoped, so a uniform 12-char length is used (see {@link ID_POLICY}).
 *
 * @returns A 12-character NanoID string
 */
export function generateIdForDocumentTag(): string {
  return generateId("documentTag");
}

/* ------------------------------- iam ------------------------------------- */

/**
 * Generates a user-friendly ID for user-facing purposes using NanoID.
 * Optimized for user interfaces with 16 characters for good readability
 * while maintaining sufficient collision resistance for user accounts.
 *
 * @returns A 16-character NanoID string containing:
 *   - Characters: URL-safe base64 (A-Z, a-z, 0-9, _, -)
 *   - Collision probability: ~1 in 10^24 for 1 billion users
 *   - Suitable for user profiles, usernames, and public-facing IDs
 */
export function generateIdForUser(): string {
  return generateId("user");
}

/**
 * Generates a compact ID for environment and configuration purposes using NanoID.
 * Shorter length (11 characters) optimized for configuration keys, environment
 * variables, and internal system identifiers where brevity is important.
 *
 * @returns An 11-character NanoID string containing:
 *   - Characters: URL-safe base64 (A-Z, a-z, 0-9, _, -)
 *   - Collision probability: ~1 in 10^16 for 1 million environments
 *   - Suitable for config keys, environment names, and internal IDs
 */
export function generateIdForEnvironment(): string {
  return generateId("environment");
}

/* ----------------------------- storage ----------------------------------- */

/**
 * Generates a high-entropy ID for storage purposes using NanoID with extended character set.
 * Uses the ALL character set (alphanumeric + underscore) with 32 characters for maximum
 * entropy and collision resistance, ideal for critical storage operations.
 *
 * @returns A 32-character NanoID string containing:
 *   - Characters: All alphanumeric plus underscore (A-Z, a-z, 0-9, _)
 *   - Collision probability: ~1 in 10^48 for 1 billion records
 *   - Maximum entropy for critical storage operations
 *   - Suitable for file names, database primary keys, and storage keys
 */
export function generateIdForStorage(): string {
  return generateId("storage");
}

/* ------------------------------ notes ------------------------------------ */

/**
 * Generates a unique ID for note entities using CUID2.
 * Tenant-scoped, so a uniform 12-char length is used (see {@link ID_POLICY}).
 * Time-ordered so that natural insertion order roughly tracks creation time,
 * which helps cursor-style listings and cache locality on the notes table.
 *
 * @returns A 12-character CUID2 string.
 */
export function generateIdForNote(): string {
  return generateId("note");
}

/**
 * Generates a unique ID for note collection entities using CUID2.
 * Tenant-scoped and low-cardinality, so it keeps its 10-char length (see
 * {@link ID_POLICY}) — there's no benefit to inflating it.
 * Time-ordered for the same reasons as notes — collections are typically
 * listed in creation order in the UI.
 *
 * @returns A 10-character CUID2 string.
 */
export function generateIdForNoteCollection(): string {
  return generateId("noteCollection");
}

/**
 * Generates a unique ID for note version entities using CUID2.
 * Tenant-scoped, so a uniform 12-char length is used (see {@link ID_POLICY}).
 * Versions are inherently chronological, so a time-ordered ID keeps version
 * rows naturally sorted on disk and simplifies "latest N versions" queries.
 *
 * @returns A 12-character CUID2 string.
 */
export function generateIdForNoteVersion(): string {
  return generateId("noteVersion");
}

/**
 * Generates a unique ID for note tag entities using NanoID.
 * Tenant-scoped and low-cardinality, so it keeps its 10-char length (see
 * {@link ID_POLICY}). Tags don't benefit from time ordering — they're looked
 * up by name/owner and have a small cardinality per user, so random IDs match
 * the access pattern.
 *
 * NOTE on `generateIdForDocumentTag` vs `generateIdForNoteTag`: these remain
 * DISTINCT {@link ID_POLICY} entries with different lengths and alphabets
 * (document tags: 12-char LOWER_UPPER_NUMBERS; note tags: 10-char URL_SAFE).
 * They are kept separate because the document-tags and notes-tags subsystems
 * evolved independently and may diverge again — do not collapse them.
 *
 * @returns A 10-character NanoID string.
 */
export function generateIdForNoteTag(): string {
  return generateId("noteTag");
}

/* ========================================================================== */
/*             GENERIC/PARAMETRIC HELPERS (NOT entity-fixed policy)          */
/* ========================================================================== */
// These accept a caller-supplied length and therefore CANNOT live in the
// fixed {@link ID_POLICY} map. They are the generic engine surface used when a
// caller needs a one-off length (e.g. `generateIdRandom(32)`,
// `generateIdRandomWithTimestamp(16)`). Kept here so the whole ID public API
// ships from one module; they delegate straight to the engine layer.

/**
 * Generates a collision-resistant ID with timestamp information using CUID2.
 * CUID2 provides better collision resistance than NanoID by including timestamp
 * and fingerprint data, making it ideal for distributed systems.
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
 * const id = generateIdRandomWithTimestamp(); // "a7b2c9d4e8f1g5h3i6j0k2l9m4"
 * const shortId = generateIdRandomWithTimestamp(12); // "a7b2c9d4e8f1"
 * ```
 *
 * @throws {Error} When length is outside the valid range (6-128)
 */
export function generateIdRandomWithTimestamp(length: number = 24): string {
  return generateCuid2(length);
}

/**
 * Generates a random ID using NanoID with URL-safe characters.
 * NanoID provides fast generation with good collision resistance using
 * cryptographically secure random number generation.
 *
 * @param length - The desired length of the generated ID (default: 21 characters)
 *   - Minimum length: 1 character
 *   - Maximum length: 255 characters (practical limit)
 *   - Recommended range: 8-32 characters for optimal performance
 * @returns A NanoID string containing:
 *   - Characters: URL-safe base64 (A-Z, a-z, 0-9, _, -)
 *   - No special characters that could cause issues in URLs or databases
 *   - Cryptographically secure random generation
 *
 * @example
 * ```ts
 * const id = generateIdRandom(); // "V1StGXR8_Z5jdHi6B-myT4Kz"
 * const shortId = generateIdRandom(8); // "V1StGXR8"
 * const longId = generateIdRandom(32); // "V1StGXR8_Z5jdHi6B-myT4KzV1StGXR8"
 * ```
 *
 * @throws {Error} When length is less than 1
 */
export function generateIdRandom(length: number = 21): string {
  return generateRandomId(length);
}
