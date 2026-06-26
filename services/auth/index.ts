/**
 * @file services/auth/index.ts
 * @description Main export file for authentication services
 * Exports service classes, types, and singleton getter functions
 */

// Pure magic-link context helpers (Phase B handlers import hashUserAgent via this barrel)
export { detectContextMismatch, hashUserAgent, normalizeUserAgent } from "./magic-link-context.helper.ts";
export type { MagicLinkContext } from "./magic-link-context.helper.ts";

// Pure magic-link completion-decision helper (G2-C): routes a verified consume to
// direct-session / two-factor / passkey-unwrap / unsupported based on the E2EE flag.
export { decideMagicLinkCompletion } from "./magic-link-completion.helper.ts";
export type { MagicLinkCompletionDecision, MagicLinkCompletionInput } from "./magic-link-completion.helper.ts";

// Export service classes
export { PasswordResetService } from "./password-reset.service.ts";
export { AuthUserLookupService } from "./user-lookup.service.ts";
export { UserRegistrationService } from "./user-registration.service.ts";
export { PasskeyLoginService } from "./passkey-login.service.ts";
export { AuthTOTPGenerationService, AuthTOTPValidationService } from "./mfa-totp.service.ts";
export { AuthPasskeyAuthenticationService, AuthPasskeyRegistrationService } from "./passkey-auth.service.ts";
export { AuthTokenHelperService } from "./token-helper.service.ts";
export { AuthMagicService } from "./magic-link.service.ts";
export { AuthPasswordService } from "./password-auth.service.ts";
export { AccountRecoveryService } from "./account-recovery.service.ts";
export { UserMasterKeySetupService } from "./user-master-key-setup.service.ts";

// Export singleton getter functions from singletons.ts
export {
  getAccountRecoveryService,
  getAuthMagicService,
  getAuthPasskeyAuthenticationService,
  getAuthPasskeyRegistrationService,
  getAuthPasswordService,
  getAuthTokenHelperService,
  getAuthTOTPGenerationService,
  getAuthTOTPValidationService,
  getAuthUserLookupService,
  getPasskeyLoginService,
  getPasswordResetService,
  getUserMasterKeySetupService,
  getUserRegistrationService,
  resetAuthSingletons,
} from "./singletons.ts";
