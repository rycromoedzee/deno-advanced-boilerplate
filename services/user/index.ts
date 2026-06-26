/**
 * @file services/user/index.ts
 * @description Barrel re-exports for the user feature services.
 */

// Service classes
export { RecoveryPhraseCreateService, RecoveryPhraseValidateService } from "./recovery-phrase.service.ts";
export { UserLookupService } from "./lookup.service.ts";
export { UserEnhancedEncryptionSettingsService } from "./enhanced-encryption.service.ts";
export { AsymmetricKeysService } from "./asymmetric-keys.service.ts";
export { UserTwoFactorService } from "./two-factor.service.ts";
export { getCurrentUserService } from "./get-current-user.service.ts";
export { getCurrentUserProfileConfigService } from "./get-current-user-profile-config.service.ts";
export { PasskeyManagementService } from "./passkey-management.service.ts";
export { UserPasswordService } from "./password.service.ts";
export { UserAPIKeysCreateService } from "./api-keys/create-key.service.ts";

// Singleton getters
export {
  getPasskeyManagementService,
  getRecoveryPhraseCreateService,
  getRecoveryPhraseValidateService,
  getUserAPIKeysCreateService,
  getUserAsymmetricKeysService,
  getUserEnhancedEncryptionSettingsService,
  getUserLookupService,
  getUserPasswordService,
  getUserTwoFactorService,
} from "./singletons.ts";

// User notification preferences
export {
  getUserNotificationsCreateService,
  getUserNotificationsDeleteService,
  getUserNotificationsListService,
  hasNotificationPrefSet,
  UserNotificationsCreateService,
  UserNotificationsDeleteService,
  UserNotificationsListService,
} from "./notifications/index.ts";

// Export types
export type { IUserEnvironment, IUserLookupResult, IUserTwoFactor, IUserWithEnvironment } from "@interfaces/user.ts";
export type { UserPreferenceInput } from "./notifications/index.ts";
