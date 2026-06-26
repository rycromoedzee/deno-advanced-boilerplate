/**
 * @file handlers/user/index.ts
 * @description User handler exports
 */

export { getCurrentUserHandler } from "./get-current-user.handler.ts";
export { getCurrentUserProfileConfigHandler } from "./get-current-user-profile-config.handler.ts";
export {
  batchUpdateUserPreferencesHandler,
  getUserPreferencesGroupedHandler,
  resetUserPreferenceHandler,
  updateUserPreferenceHandler,
} from "./user-notification-preferences.handler.ts";
export {
  addPasskeyBeginHandler,
  addPasskeyVerifyHandler,
  deletePasskeyHandler,
  listPasskeysHandler,
  passkeyPrfSetupBeginHandler,
  passkeyPrfSetupVerifyHandler,
  reauthPasskeyBeginHandler,
  reauthPasskeyVerifyHandler,
  reauthPasswordHandler,
} from "./passkey.handler.ts";
export { changePasswordHandler, setPasswordHandler } from "./password.handler.ts";
export {
  createTwoFactorHandler,
  deleteTwoFactorHandler,
  getTwoFactorStatusHandler,
  listTwoFactorHandler,
  regenerateBackupCodesHandler,
  revealTwoFactorHandler,
} from "./two-factor.handler.ts";
export {
  createRecoveryPhraseHandler,
  deleteRecoveryPhraseHandler,
  getRecoveryPhraseStatusHandler,
  resetRecoveryPhraseHandler,
  verifyRecoveryPhraseHandler,
} from "./recovery-phrase.handler.ts";
export { createApiKeyHandler } from "./api-key/create.handler.ts";
export { extendHandler } from "./api-key/extend.handler.ts";
export { userApiKeyRevokeHandler } from "./api-key/revoke.handler.ts";
