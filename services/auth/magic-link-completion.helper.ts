/**
 * @file services/auth/magic-link-completion.helper.ts
 * @description Pure routing decision for magic-link consume completion (G2-C).
 *
 * Keeps the security-relevant branching out of the handler so it is unit-testable
 * in isolation (repo seam discipline — pure in-process logic, like
 * `magic-link-context.helper.ts`). The handler (handlers/auth/magic.handler.ts)
 * calls {@link decideMagicLinkCompletion} and exhaustively switches on the
 * resulting kind.
 */

/**
 * Inputs to the completion decision. These mirror the fields resolved by
 * `AuthMagicService.resolveMagicLinkConsumer` (services/auth/magic-link.service.ts)
 * — the helper holds no I/O of its own.
 */
export type MagicLinkCompletionInput = {
  /** Whether the user has opted into enhanced (E2EE, user-controlled) encryption. */
  isEnhancedEncryptionEnabled: boolean;
  isTwoFactorEnabled: boolean;
  /** Has at least one registered passkey (PRF master-key unwrap path). */
  hasPasskey: boolean;
  /** Has a recovery phrase set (independent master-key unwrap path). */
  hasRecoveryPhrase: boolean;
};

/**
 * How a verified magic-link consume should complete.
 *
 * - `direct-session` — E2EE off, no 2FA: mint a key-less session now.
 * - `two-factor` — E2EE off, 2FA on: issue a 2FA challenge carrying NO derived
 *   key; the shared two-factor handler completes a key-less session.
 * - `passkey-unwrap` — E2EE on, passkey, no 2FA: hand off to passkey-login, which
 *   unwraps the master key via PRF and mints a full session.
 * - `unsupported` — an E2EE-on configuration with no wired unwrap continuation.
 *   `key_factor_required` (403) for a password-only account with no independent
 *   unwrap path at all; `completion_unsupported` (409) for recovery-only or any
 *   2FA-combined configuration whose continuation is not built yet.
 */
export type MagicLinkCompletionDecision =
  | { kind: "direct-session" }
  | { kind: "two-factor" }
  | { kind: "passkey-unwrap" }
  | { kind: "unsupported"; reason: "key_factor_required" | "completion_unsupported" };

/**
 * Decide how a verified magic-link consume should complete.
 *
 * E2EE OFF: document data keys are wrapped by the app-controlled key
 * (services/encryption/data-access.service.ts), so the master key is never
 * needed and a key-less session is sufficient — exactly like a passkey login
 * (services/session/session-create.service.ts passes `undefined`).
 *
 * E2EE ON: the master key MUST be unwrapped via an independent factor. Only the
 * passkey PRF path is wired today; recovery-phrase / password step-up and the
 * combined 2FA+unwrap continuation are follow-ups, so those configurations are
 * refused honestly rather than minting a session that cannot read user data.
 */
export function decideMagicLinkCompletion(
  input: MagicLinkCompletionInput,
): MagicLinkCompletionDecision {
  if (!input.isEnhancedEncryptionEnabled) {
    return input.isTwoFactorEnabled ? { kind: "two-factor" } : { kind: "direct-session" };
  }

  // E2EE enabled from here on — an independent unwrap factor is mandatory.
  if (!input.hasPasskey && !input.hasRecoveryPhrase) {
    // Password-only E2EE account: no independent unwrap path exists at all.
    return { kind: "unsupported", reason: "key_factor_required" };
  }
  if (input.isTwoFactorEnabled) {
    // Combined 2FA + key-unwrap continuation is not built yet (any factor).
    return { kind: "unsupported", reason: "completion_unsupported" };
  }
  if (input.hasPasskey) {
    return { kind: "passkey-unwrap" };
  }
  // Recovery-phrase-only: no consume-time recovery step-up endpoint wired yet.
  return { kind: "unsupported", reason: "completion_unsupported" };
}
