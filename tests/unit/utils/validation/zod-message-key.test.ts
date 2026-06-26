import { assertEquals, assertExists } from "@std/assert";
import { parseMessageKey, withKey } from "@utils/validation/zod-message-key.ts";

/**
 * messageKey embedding/parsing for Zod error messages.
 *
 * Format: "messageKey|human-readable message" (pipe-delimited). The key half
 * must match the dotted kebab-case pattern `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`
 * (at least two dot-separated segments, each kebab-case starting lowercase).
 */

Deno.test("withKey: joins key and message with a pipe", () => {
  assertEquals(
    withKey("encryption.password-required", "Password is required"),
    "encryption.password-required|Password is required",
  );
  assertEquals(withKey("auth.token-expired", "Session expired"), "auth.token-expired|Session expired");
});

Deno.test("parseMessageKey: splits a well-formed key|message back into parts", () => {
  const parsed = parseMessageKey("encryption.password-required|Password is required");
  assertEquals(parsed.messageKey, "encryption.password-required");
  assertEquals(parsed.message, "Password is required");
});

Deno.test("parseMessageKey: handles a message containing its own pipe characters", () => {
  // Only the FIRST pipe separates key from message; the rest stays in the message.
  const parsed = parseMessageKey("validation.bad-input|a || b | c");
  assertEquals(parsed.messageKey, "validation.bad-input");
  assertEquals(parsed.message, "a || b | c");
});

Deno.test("parseMessageKey round-trip: withKey then parseMessageKey is identity", () => {
  const key = "encryption.password-required";
  const message = "Password is required";
  const encoded = withKey(key, message);
  const decoded = parseMessageKey(encoded);
  assertEquals(decoded.messageKey, key);
  assertEquals(decoded.message, message);
});

Deno.test("parseMessageKey: message with NO key falls back to the default fallback key", () => {
  const parsed = parseMessageKey("Password is required");
  assertEquals(parsed.messageKey, "validation.schema-validation-failed");
  assertEquals(parsed.message, "Password is required");
});

Deno.test("parseMessageKey: message with no key honours a custom fallback key", () => {
  const parsed = parseMessageKey("Something broke", "custom.fallback-key");
  assertEquals(parsed.messageKey, "custom.fallback-key");
  assertEquals(parsed.message, "Something broke");
});

Deno.test("parseMessageKey: rejects an invalid key prefix (single segment, no dot)", () => {
  // A valid key must have at least two dot-separated segments.
  const parsed = parseMessageKey("passwordrequired|Password is required");
  assertEquals(parsed.messageKey, "validation.schema-validation-failed"); // fallback
  assertEquals(parsed.message, "passwordrequired|Password is required");
});

Deno.test("parseMessageKey: rejects an invalid key prefix (uppercase / not kebab-case)", () => {
  const parsed = parseMessageKey("Encryption.PasswordRequired|Password is required");
  assertEquals(parsed.messageKey, "validation.schema-validation-failed"); // fallback
  assertEquals(parsed.message, "Encryption.PasswordRequired|Password is required");
});

Deno.test("parseMessageKey: rejects when the pipe is at the start (empty key)", () => {
  // pipeIndex must be > 0, so a leading pipe is treated as a keyless message.
  const parsed = parseMessageKey("|Password is required");
  assertEquals(parsed.messageKey, "validation.schema-validation-failed");
  assertEquals(parsed.message, "|Password is required");
});

Deno.test("parseMessageKey: rejects when the pipe is at the end (empty message)", () => {
  // pipeIndex must be < raw.length - 1, so a trailing pipe is treated as keyless.
  const parsed = parseMessageKey("encryption.password-required|");
  assertEquals(parsed.messageKey, "validation.schema-validation-failed");
  assertEquals(parsed.message, "encryption.password-required|");
});

Deno.test("parseMessageKey: always returns both messageKey and message", () => {
  const parsed = parseMessageKey("anything");
  assertExists(parsed.messageKey);
  assertExists(parsed.message);
  assertEquals(typeof parsed.messageKey, "string");
  assertEquals(typeof parsed.message, "string");
});
