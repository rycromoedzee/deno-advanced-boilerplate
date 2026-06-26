/**
 * @file tests/unit/services/auth/magic-link-completion.helper.test.ts
 * @description Pure-logic tests for the magic-link completion-decision helper (G2-C).
 *
 * No DB / no network — this is a pure in-process routing decision (repo seam
 * discipline), tested directly through its interface.
 */
import { assertEquals } from "@std/assert";
import { decideMagicLinkCompletion, type MagicLinkCompletionInput } from "@services/auth/magic-link-completion.helper.ts";

/** Baseline consumer state: E2EE off, no 2FA, no key-bearing factors. */
const base: MagicLinkCompletionInput = {
  isEnhancedEncryptionEnabled: false,
  isTwoFactorEnabled: false,
  hasPasskey: false,
  hasRecoveryPhrase: false,
};

Deno.test("decideMagicLinkCompletion: E2EE off, no 2FA -> direct key-less session", () => {
  assertEquals(decideMagicLinkCompletion(base), { kind: "direct-session" });
});

Deno.test("decideMagicLinkCompletion: E2EE off, 2FA on -> two-factor challenge (no key needed)", () => {
  assertEquals(
    decideMagicLinkCompletion({ ...base, isTwoFactorEnabled: true }),
    { kind: "two-factor" },
  );
});

Deno.test("decideMagicLinkCompletion: E2EE on, passkey, no 2FA -> passkey unwrap handoff", () => {
  assertEquals(
    decideMagicLinkCompletion({ ...base, isEnhancedEncryptionEnabled: true, hasPasskey: true }),
    { kind: "passkey-unwrap" },
  );
});

Deno.test("decideMagicLinkCompletion: E2EE on, password-only (no factor) -> key factor required (403)", () => {
  assertEquals(
    decideMagicLinkCompletion({ ...base, isEnhancedEncryptionEnabled: true }),
    { kind: "unsupported", reason: "key_factor_required" },
  );
});

Deno.test("decideMagicLinkCompletion: E2EE on, recovery-only, no 2FA -> unsupported (409, not wired)", () => {
  assertEquals(
    decideMagicLinkCompletion({ ...base, isEnhancedEncryptionEnabled: true, hasRecoveryPhrase: true }),
    { kind: "unsupported", reason: "completion_unsupported" },
  );
});

Deno.test("decideMagicLinkCompletion: E2EE on, passkey + 2FA -> unsupported (409, combined flow not built)", () => {
  assertEquals(
    decideMagicLinkCompletion({
      ...base,
      isEnhancedEncryptionEnabled: true,
      hasPasskey: true,
      isTwoFactorEnabled: true,
    }),
    { kind: "unsupported", reason: "completion_unsupported" },
  );
});

Deno.test("decideMagicLinkCompletion: E2EE on, recovery + 2FA -> unsupported (409, combined flow not built)", () => {
  assertEquals(
    decideMagicLinkCompletion({
      ...base,
      isEnhancedEncryptionEnabled: true,
      hasRecoveryPhrase: true,
      isTwoFactorEnabled: true,
    }),
    { kind: "unsupported", reason: "completion_unsupported" },
  );
});
