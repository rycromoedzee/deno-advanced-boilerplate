/**
 * @file handlers/user-encryption/index.ts
 * @description User encryption handler exports
 */

export {
  canEnableEncryptionHandler,
  checkEncryptionStatusHandler,
  disableEnhancedEncryptionHandler,
  enhancedEncryptionOptInHandler,
  enhancedEncryptionOptInPasskeyHandler,
  initiatePRFSetupHandler,
  rewrapStalePasskeyHandler,
  rotateMasterKeyHandler,
  verifyPRFSetupHandler,
  verifyRecoveryPhraseHandler,
} from "./user-encryption.handler.ts";
