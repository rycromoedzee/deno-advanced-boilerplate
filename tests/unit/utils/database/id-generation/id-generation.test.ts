import { assert, assertEquals, assertExists } from "@std/assert";
import {
  cuid2ClearFingerprintCache,
  generateId,
  generateIdForDocument,
  generateIdForDocumentFolder,
  generateIdForDocumentTag,
  generateIdForEnvironment,
  generateIdForNote,
  generateIdForNoteCollection,
  generateIdForNoteTag,
  generateIdForNoteVersion,
  generateIdForStorage,
  generateIdForUser,
  generateIdRandom,
  generateIdRandomWithTimestamp,
  ID_POLICY,
  isValidCuid2,
  isValidNanoId,
} from "@utils/database/id-generation/index.ts";
// generateCuid2 + GenerateIdCharacters live on the generator module but are
// NOT re-exported by the id-generation index barrel (they're marked internal-
// use). Import them from source so the tests can exercise the engine directly
// and compare ID_POLICY alphabet values against the canonical charsets.
import { generateCuid2, GenerateIdCharacters, generateRandomId } from "@utils/database/id-generation/generator.ts";

/**
 * Unified ID policy + per-entity delegates (Phase 9c).
 *
 * The ID_POLICY map is the single source of truth for (engine, length, alphabet)
 * per entity. These tests assert:
 *   - each delegate produces IDs of the EXACT configured length and charset,
 *   - generateId(entity) is equivalent to the typed delegate,
 *   - IDs are unique across many generations,
 *   - the two generic helpers and the validators behave per contract.
 */

const LOWER_UPPER_NUMBERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ALL_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
const URL_SAFE = "_-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function assertAllCharsIn(id: string, alphabet: string, label: string): void {
  for (const ch of id) {
    assertTrue(alphabet.includes(ch), `${label}: char '${ch}' not in alphabet (id=${id})`);
  }
}

/* ----------------------------- ID_POLICY shape ---------------------------- */

Deno.test("ID_POLICY: is frozen and covers every documented entity", () => {
  assertTrue(Object.isFrozen(ID_POLICY), "ID_POLICY should be frozen");
  const expectedEntities = [
    "document",
    "documentFolder",
    "documentTag",
    "user",
    "environment",
    "storage",
    "note",
    "noteCollection",
    "noteVersion",
    "noteTag",
  ];
  for (const entity of expectedEntities) {
    assertExists((ID_POLICY as Record<string, unknown>)[entity], `missing entity ${entity}`);
  }
});

Deno.test("ID_POLICY: matches the documented table byte-for-byte", () => {
  assertEquals(ID_POLICY.document, { engine: "nanoid", length: 12, alphabet: LOWER_UPPER_NUMBERS });
  assertEquals(ID_POLICY.documentFolder, { engine: "nanoid", length: 12, alphabet: LOWER_UPPER_NUMBERS });
  assertEquals(ID_POLICY.documentTag, { engine: "nanoid", length: 12, alphabet: LOWER_UPPER_NUMBERS });
  assertEquals(ID_POLICY.user, { engine: "nanoid", length: 16, alphabet: LOWER_UPPER_NUMBERS });
  assertEquals(ID_POLICY.environment, { engine: "nanoid", length: 11, alphabet: LOWER_UPPER_NUMBERS });
  assertEquals(ID_POLICY.storage, { engine: "nanoid", length: 32, alphabet: ALL_ALPHABET });
  assertEquals(ID_POLICY.note, { engine: "cuid2", length: 12 });
  assertEquals(ID_POLICY.noteCollection, { engine: "cuid2", length: 10 });
  assertEquals(ID_POLICY.noteVersion, { engine: "cuid2", length: 12 });
  assertEquals(ID_POLICY.noteTag, { engine: "nanoid", length: 10, alphabet: URL_SAFE });
});

/* --------------------- per-entity delegate length+charset ------------------ */

Deno.test("generateIdForDocument: 12 chars from LOWER_UPPER_NUMBERS", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForDocument();
    assertEquals(id.length, 12);
    assertAllCharsIn(id, LOWER_UPPER_NUMBERS, "document");
  }
});

Deno.test("generateIdForDocumentFolder: 12 chars from LOWER_UPPER_NUMBERS", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForDocumentFolder();
    assertEquals(id.length, 12);
    assertAllCharsIn(id, LOWER_UPPER_NUMBERS, "documentFolder");
  }
});

Deno.test("generateIdForDocumentTag: 12 chars from LOWER_UPPER_NUMBERS", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForDocumentTag();
    assertEquals(id.length, 12);
    assertAllCharsIn(id, LOWER_UPPER_NUMBERS, "documentTag");
  }
});

Deno.test("generateIdForUser: 16 chars from LOWER_UPPER_NUMBERS", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForUser();
    assertEquals(id.length, 16);
    assertAllCharsIn(id, LOWER_UPPER_NUMBERS, "user");
  }
});

Deno.test("generateIdForEnvironment: 11 chars from LOWER_UPPER_NUMBERS", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForEnvironment();
    assertEquals(id.length, 11);
    assertAllCharsIn(id, LOWER_UPPER_NUMBERS, "environment");
  }
});

Deno.test("generateIdForStorage: 32 chars from ALL (alphanumeric + underscore, no dash)", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForStorage();
    assertEquals(id.length, 32);
    assertAllCharsIn(id, ALL_ALPHABET, "storage");
    assertFalse(id.includes("-"), "storage IDs must never contain '-'");
  }
});

Deno.test("generateIdForNote: 12 chars, cuid2 (lowercase alpha first, base36 body)", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForNote();
    assertEquals(id.length, 12);
    assertTrue(/^[a-z][0-9a-z]+$/.test(id), `note id should be valid cuid2: ${id}`);
    assertTrue(isValidCuid2(id), `note id should pass isValidCuid2: ${id}`);
  }
});

Deno.test("generateIdForNoteCollection: 10 chars, cuid2", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForNoteCollection();
    assertEquals(id.length, 10);
    assertTrue(isValidCuid2(id), `noteCollection id should pass isValidCuid2: ${id}`);
  }
});

Deno.test("generateIdForNoteVersion: 12 chars, cuid2", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateIdForNoteVersion();
    assertEquals(id.length, 12);
    assertTrue(isValidCuid2(id), `noteVersion id should pass isValidCuid2: ${id}`);
  }
});

Deno.test("generateIdForNoteTag: 10 chars from URL_SAFE, trailing char is alphanumeric", () => {
  for (let i = 0; i < 500; i++) {
    const id = generateIdForNoteTag();
    assertEquals(id.length, 10);
    assertAllCharsIn(id, URL_SAFE, "noteTag");
    // The generator guarantees the last char is alphanumeric (not _ or -).
    assertTrue(/[A-Za-z0-9]/.test(id[id.length - 1]), `noteTag trailing char should be alphanum: ${id}`);
  }
});

/* --------------------- generateId(entity) parity with delegates ------------- */

Deno.test("generateId: produces the same length+alphabet as each typed delegate", () => {
  // Compare BOTH length AND alphabet membership — length alone would pass even
  // if a delegate silently switched alphabet (same length, different chars).
  const pairs: Array<[Parameters<typeof generateId>[0], () => string, string | undefined]> = [
    ["document", generateIdForDocument, LOWER_UPPER_NUMBERS],
    ["user", generateIdForUser, LOWER_UPPER_NUMBERS],
    ["storage", generateIdForStorage, ALL_ALPHABET],
    ["noteTag", generateIdForNoteTag, URL_SAFE],
    ["note", generateIdForNote, undefined], // cuid2 (base36) — length only, no alphabet
  ];
  for (const [entity, delegate, alphabet] of pairs) {
    const fromGeneric = generateId(entity);
    const fromDelegate = delegate();
    assertEquals(fromGeneric.length, fromDelegate.length, `${entity}: generic vs delegate length`);
    if (alphabet) {
      assertAllCharsIn(fromGeneric, alphabet, `${entity} (generic)`);
      assertAllCharsIn(fromDelegate, alphabet, `${entity} (delegate)`);
    }
  }
});

Deno.test("generateId: routes nanoid vs cuid2 correctly by engine", () => {
  // cuid2 always starts lowercase-alpha; nanoid may start with any alphabet char.
  const noteId = generateId("note");
  assertTrue(/^[a-z]/.test(noteId), `cuid2 id should start lowercase: ${noteId}`);
  // storage uses nanoid with ALL alphabet — first char in [0-9A-Z_a-z].
  const storageId = generateId("storage");
  assertTrue(/[0-9A-Za-z_]/.test(storageId[0]));
});

/* ----------------------------- uniqueness --------------------------------- */

Deno.test("uniqueness: 5000 generated IDs per engine are all distinct", () => {
  const documentIds = new Set<string>();
  const noteIds = new Set<string>();
  const storageIds = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    documentIds.add(generateIdForDocument());
    noteIds.add(generateIdForNote());
    storageIds.add(generateIdForStorage());
  }
  assertEquals(documentIds.size, 5000, "document IDs should all be unique");
  assertEquals(noteIds.size, 5000, "note (cuid2) IDs should all be unique");
  assertEquals(storageIds.size, 5000, "storage IDs should all be unique");
});

/* --------------------------- generic helpers ------------------------------ */

Deno.test("generateIdRandomWithTimestamp: default length 24, cuid2; custom length honoured", () => {
  const def = generateIdRandomWithTimestamp();
  assertEquals(def.length, 24);
  assertTrue(isValidCuid2(def));
  const short = generateIdRandomWithTimestamp(12);
  assertEquals(short.length, 12);
  assertTrue(isValidCuid2(short));
});

Deno.test("generateIdRandomWithTimestamp: throws for length below the 6-char minimum", () => {
  assertThrows(() => generateIdRandomWithTimestamp(5));
  assertThrows(() => generateIdRandomWithTimestamp(0));
});

Deno.test("generateIdRandom: default length 21, URL-safe charset", () => {
  const def = generateIdRandom();
  assertEquals(def.length, 21);
  assertAllCharsIn(def, URL_SAFE, "generateIdRandom default");
  assertTrue(isValidNanoId(def));
});

Deno.test("generateIdRandom: custom length honoured", () => {
  assertEquals(generateIdRandom(8).length, 8);
  assertEquals(generateIdRandom(32).length, 32);
});

Deno.test("generateIdRandom: NOTE the public API does NOT accept an alphabet (uses URL_SAFE)", () => {
  // KNOWN API GAP (logged in plans/refactor-review-log.md, Phase 11): the
  // public `generateIdRandom(length)` in id-generation.ts has NO alphabet
  // parameter — it always calls the internal `generateRandomId(length)` with
  // the default URL_SAFE alphabet. A second arg is silently ignored. The
  // internal `generateRandomId(length, alphabet)` is the only way to pick a
  // custom alphabet. Here we assert the public behaviour (URL_SAFE) and cover
  // the custom-alphabet path via the internal helper below.
  const id = generateIdRandom(20);
  assertEquals(id.length, 20);
  assertAllCharsIn(id, URL_SAFE, "generateIdRandom (public, URL_SAFE)");
  assertTrue(isValidNanoId(id));
});

Deno.test("generateRandomId (internal): custom alphabet respected (numbers-only → digits only)", () => {
  // The internal engine DOES honour a custom alphabet — the public delegate
  // just doesn't expose it.
  const numeric = generateRandomId(20, GenerateIdCharacters.NUMBERS);
  assertEquals(numeric.length, 20);
  assertTrue(/^[0-9]+$/.test(numeric), `expected digits only, got ${numeric}`);

  const lowerOnly = generateRandomId(15, GenerateIdCharacters.LOWER);
  assertEquals(lowerOnly.length, 15);
  assertTrue(/^[a-z]+$/.test(lowerOnly), `expected lowercase only, got ${lowerOnly}`);
});

/* ----------------------------- validators --------------------------------- */

Deno.test("isValidCuid2: true for valid cuid2 strings, false otherwise", () => {
  assertTrue(isValidCuid2(generateCuid2(14)));
  assertTrue(isValidCuid2("abcdefghijklmnopqrstuvwxyz0123456789")); // 36 chars, base36
  assertFalse(isValidCuid2("ABC123")); // uppercase start
  assertFalse(isValidCuid2("a")); // too short (< 6)
  assertFalse(isValidCuid2("")); // empty
  assertFalse(isValidCuid2(123 as unknown as string)); // non-string
  assertFalse(isValidCuid2("abc!23")); // invalid char
});

Deno.test("isValidNanoId: true for URL-safe strings, false otherwise", () => {
  assertTrue(isValidNanoId(generateIdRandom()));
  assertTrue(isValidNanoId("abc123_-XYZ"));
  assertFalse(isValidNanoId("")); // empty
  assertFalse(isValidNanoId("has space")); // space not URL-safe
  assertFalse(isValidNanoId("bad@char"));
  assertFalse(isValidNanoId(42 as unknown as string)); // non-string
});

/* ----------------------------- engine internals --------------------------- */

Deno.test("generateCuid2: produces IDs of the requested length, always lowercase-alpha first", () => {
  for (const len of [6, 10, 14, 24, 30]) {
    const id = generateCuid2(len);
    assertEquals(id.length, len, `length ${len} not honoured`);
    assertTrue(/^[a-z]/.test(id), `cuid2 must start lowercase: ${id}`);
  }
});

Deno.test("cuid2ClearFingerprintCache: is callable and does not throw", () => {
  // Just exercises the cache-clear path; no observable return.
  cuid2ClearFingerprintCache();
  // Generate after clearing still works.
  assertTrue(generateCuid2(12).length === 12);
});

/* ------------------------------ helpers ----------------------------------- */

function assertTrue<T>(value: T, message?: string): void {
  assert(value, message ?? `expected truthy, got ${String(value)}`);
}

function assertFalse(value: unknown, message?: string): void {
  assert(!value, message ?? `expected falsy, got ${String(value)}`);
}

function assertThrows(fn: () => unknown, message?: string): void {
  let threw = false;
  try {
    fn();
  } catch (_e) {
    threw = true;
  }
  assert(threw, message ?? "expected function to throw");
}
