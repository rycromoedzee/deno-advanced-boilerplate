/**
 * @file services/auth/singletons.ts
 * @description Singleton management for authentication services
 * Separated from index.ts to prevent circular dependencies
 */

// Import service classes
import { AuthMagicService } from "./magic-link.service.ts";
import { AuthTokenHelperService } from "./token-helper.service.ts";
import { AuthPasswordService } from "./password-auth.service.ts";
import { AuthUserLookupService } from "./user-lookup.service.ts";
import { PasswordResetService } from "./password-reset.service.ts";
import { UserRegistrationService } from "./user-registration.service.ts";
import { PasskeyLoginService } from "./passkey-login.service.ts";
import { AuthTOTPGenerationService, AuthTOTPValidationService } from "./mfa-totp.service.ts";
import { AuthPasskeyAuthenticationService, AuthPasskeyRegistrationService } from "./passkey-auth.service.ts";
import { UserMasterKeySetupService } from "./user-master-key-setup.service.ts";
import { AccountRecoveryService } from "./account-recovery.service.ts";

// Singleton instances
let authMagicServiceInstance: AuthMagicService | null = null;
let authTokenHelperServiceInstance: AuthTokenHelperService | null = null;
let authPasswordServiceInstance: AuthPasswordService | null = null;
let authUserLookupServiceInstance: AuthUserLookupService | null = null;
let passwordResetServiceInstance: PasswordResetService | null = null;
let userRegistrationServiceInstance: UserRegistrationService | null = null;
let passkeyLoginServiceInstance: PasskeyLoginService | null = null;
let authTOTPValidationServiceInstance: AuthTOTPValidationService | null = null;
let authTOTPGenerationServiceInstance: AuthTOTPGenerationService | null = null;
let authPasskeyRegistrationServiceInstance:
  | AuthPasskeyRegistrationService
  | null = null;
let authPasskeyAuthenticationServiceInstance:
  | AuthPasskeyAuthenticationService
  | null = null;
let userMasterKeySetupServiceInstance: UserMasterKeySetupService | null = null;
let accountRecoveryServiceInstance: AccountRecoveryService | null = null;

/**
 * Gets the singleton instance of AuthMagicService
 */
export function getAuthMagicService(): AuthMagicService {
  if (!authMagicServiceInstance) {
    try {
      authMagicServiceInstance = new AuthMagicService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AuthMagicService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return authMagicServiceInstance;
}

/**
 * Gets the singleton instance of AuthTokenHelperService
 */
export function getAuthTokenHelperService(): AuthTokenHelperService {
  if (!authTokenHelperServiceInstance) {
    try {
      authTokenHelperServiceInstance = new AuthTokenHelperService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AuthTokenHelperService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return authTokenHelperServiceInstance;
}

/**
 * Gets the singleton instance of AuthPasswordService
 */
export function getAuthPasswordService(): AuthPasswordService {
  if (!authPasswordServiceInstance) {
    try {
      authPasswordServiceInstance = new AuthPasswordService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AuthPasswordService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return authPasswordServiceInstance;
}

/**
 * Gets the singleton instance of AuthUserLookupService
 */
export function getAuthUserLookupService(): AuthUserLookupService {
  if (!authUserLookupServiceInstance) {
    try {
      authUserLookupServiceInstance = new AuthUserLookupService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AuthUserLookupService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return authUserLookupServiceInstance;
}

/**
 * Gets the singleton instance of PasswordResetService
 */
export function getPasswordResetService(): PasswordResetService {
  if (!passwordResetServiceInstance) {
    try {
      passwordResetServiceInstance = new PasswordResetService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PasswordResetService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return passwordResetServiceInstance;
}

/**
 * Gets the singleton instance of UserRegistrationService
 */
export function getUserRegistrationService(): UserRegistrationService {
  if (!userRegistrationServiceInstance) {
    try {
      userRegistrationServiceInstance = new UserRegistrationService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserRegistrationService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userRegistrationServiceInstance;
}

/**
 * Gets the singleton instance of PasskeyLoginService
 */
export function getPasskeyLoginService(): PasskeyLoginService {
  if (!passkeyLoginServiceInstance) {
    try {
      passkeyLoginServiceInstance = new PasskeyLoginService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PasskeyLoginService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return passkeyLoginServiceInstance;
}

/**
 * Gets the singleton instance of AuthTOTPValidationService
 */
export function getAuthTOTPValidationService(): AuthTOTPValidationService {
  if (!authTOTPValidationServiceInstance) {
    try {
      authTOTPValidationServiceInstance = new AuthTOTPValidationService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AuthTOTPValidationService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return authTOTPValidationServiceInstance;
}

/**
 * Gets the singleton instance of AuthTOTPGenerationService
 */
export function getAuthTOTPGenerationService(): AuthTOTPGenerationService {
  if (!authTOTPGenerationServiceInstance) {
    try {
      authTOTPGenerationServiceInstance = new AuthTOTPGenerationService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AuthTOTPGenerationService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return authTOTPGenerationServiceInstance;
}

/**
 * Gets the singleton instance of AuthPasskeyRegistrationService
 */
export function getAuthPasskeyRegistrationService(): AuthPasskeyRegistrationService {
  if (!authPasskeyRegistrationServiceInstance) {
    try {
      authPasskeyRegistrationServiceInstance = new AuthPasskeyRegistrationService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AuthPasskeyRegistrationService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return authPasskeyRegistrationServiceInstance;
}

/**
 * Gets the singleton instance of AuthPasskeyAuthenticationService
 */
export function getAuthPasskeyAuthenticationService(): AuthPasskeyAuthenticationService {
  if (!authPasskeyAuthenticationServiceInstance) {
    try {
      authPasskeyAuthenticationServiceInstance = new AuthPasskeyAuthenticationService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AuthPasskeyAuthenticationService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return authPasskeyAuthenticationServiceInstance;
}

/**
 * Gets the singleton instance of UserMasterKeySetupService
 */
export function getUserMasterKeySetupService(): UserMasterKeySetupService {
  if (!userMasterKeySetupServiceInstance) {
    try {
      userMasterKeySetupServiceInstance = new UserMasterKeySetupService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserMasterKeySetupService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userMasterKeySetupServiceInstance;
}

/**
 * Gets the singleton instance of AccountRecoveryService
 */
export function getAccountRecoveryService(): AccountRecoveryService {
  if (!accountRecoveryServiceInstance) {
    try {
      accountRecoveryServiceInstance = new AccountRecoveryService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AccountRecoveryService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return accountRecoveryServiceInstance;
}

/**
 * Test utility function to reset singleton instances.
 * This should only be used in test environments.
 * @internal
 */
export function resetAuthSingletons(): void {
  authMagicServiceInstance = null;
  authTokenHelperServiceInstance = null;
  authPasswordServiceInstance = null;
  authUserLookupServiceInstance = null;
  passwordResetServiceInstance = null;
  userRegistrationServiceInstance = null;
  passkeyLoginServiceInstance = null;
  authTOTPValidationServiceInstance = null;
  authTOTPGenerationServiceInstance = null;
  authPasskeyRegistrationServiceInstance = null;
  authPasskeyAuthenticationServiceInstance = null;
  userMasterKeySetupServiceInstance = null;
  accountRecoveryServiceInstance = null;
}
