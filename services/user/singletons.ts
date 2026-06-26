/**
 * @file services/user/singletons.ts
 * @description Lazy singletons for user services
 */
import { AsymmetricKeysService } from "./asymmetric-keys.service.ts";
import { PasskeyManagementService } from "./passkey-management.service.ts";
import { RecoveryPhraseCreateService, RecoveryPhraseValidateService } from "./recovery-phrase.service.ts";
import { UserAPIKeysCreateService } from "./api-keys/create-key.service.ts";
import { UserEnhancedEncryptionSettingsService } from "./enhanced-encryption.service.ts";
import { UserLookupService } from "./lookup.service.ts";
import { UserPasswordService } from "./password.service.ts";
import { UserTwoFactorService } from "./two-factor.service.ts";

let recoveryPhraseCreateService: RecoveryPhraseCreateService;
let recoveryPhraseValidateService: RecoveryPhraseValidateService;
let userLookupService: UserLookupService;
let userEnhancedEncryptionSettingsService: UserEnhancedEncryptionSettingsService;
let asymmetricKeysService: AsymmetricKeysService;
let passkeyManagementService: PasskeyManagementService;
let userPasswordService: UserPasswordService;
let userTwoFactorService: UserTwoFactorService;
let userAPIKeysCreateService: UserAPIKeysCreateService;

/**
 * Gets the singleton instance of RecoveryPhraseCreateService.
 * @returns {RecoveryPhraseCreateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getRecoveryPhraseCreateService(): RecoveryPhraseCreateService {
  if (!recoveryPhraseCreateService) {
    try {
      recoveryPhraseCreateService = new RecoveryPhraseCreateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize RecoveryPhraseCreateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return recoveryPhraseCreateService;
}

/**
 * Gets the singleton instance of RecoveryPhraseValidateService.
 * @returns {RecoveryPhraseValidateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getRecoveryPhraseValidateService(): RecoveryPhraseValidateService {
  if (!recoveryPhraseValidateService) {
    try {
      recoveryPhraseValidateService = new RecoveryPhraseValidateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize RecoveryPhraseValidateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return recoveryPhraseValidateService;
}

/**
 * Gets the singleton instance of UserLookupService.
 * @returns {UserLookupService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserLookupService(): UserLookupService {
  if (!userLookupService) {
    try {
      userLookupService = new UserLookupService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserLookupService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userLookupService;
}

/**
 * Gets the singleton instance of UserEnhancedEncryptionSettingsService.
 * @returns {UserEnhancedEncryptionSettingsService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserEnhancedEncryptionSettingsService(): UserEnhancedEncryptionSettingsService {
  if (!userEnhancedEncryptionSettingsService) {
    try {
      userEnhancedEncryptionSettingsService = new UserEnhancedEncryptionSettingsService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserEnhancedEncryptionSettingsService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userEnhancedEncryptionSettingsService;
}

/**
 * Gets the singleton instance of AsymmetricKeysService.
 * @returns {AsymmetricKeysService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserAsymmetricKeysService(): AsymmetricKeysService {
  if (!asymmetricKeysService) {
    try {
      asymmetricKeysService = new AsymmetricKeysService();
    } catch (error) {
      throw new Error(
        `Failed to initialize AsymmetricKeysService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return asymmetricKeysService;
}

/**
 * Gets the singleton instance of PasskeyManagementService.
 * @returns {PasskeyManagementService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getPasskeyManagementService(): PasskeyManagementService {
  if (!passkeyManagementService) {
    try {
      passkeyManagementService = new PasskeyManagementService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PasskeyManagementService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return passkeyManagementService;
}

/**
 * Gets the singleton instance of UserPasswordService.
 * @returns {UserPasswordService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserPasswordService(): UserPasswordService {
  if (!userPasswordService) {
    try {
      userPasswordService = new UserPasswordService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserPasswordService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userPasswordService;
}

/**
 * Gets the singleton instance of UserTwoFactorService.
 * @returns {UserTwoFactorService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserTwoFactorService(): UserTwoFactorService {
  if (!userTwoFactorService) {
    try {
      userTwoFactorService = new UserTwoFactorService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserTwoFactorService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userTwoFactorService;
}

/**
 * Gets the singleton instance of UserAPIKeysCreateService.
 * @returns {UserAPIKeysCreateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserAPIKeysCreateService(): UserAPIKeysCreateService {
  if (!userAPIKeysCreateService) {
    try {
      userAPIKeysCreateService = new UserAPIKeysCreateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserAPIKeysCreateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userAPIKeysCreateService;
}
