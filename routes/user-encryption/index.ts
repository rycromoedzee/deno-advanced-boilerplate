/**
 * @file routes/user-encryption/index.ts
 * @description User encryption routes
 */

import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  canEnableEncryptionRoute,
  checkEncryptionStatusRoute,
  disableEnhancedEncryptionRoute,
  enhancedEncryptionOptInPasskeyRoute,
  enhancedEncryptionOptInRoute,
  initiatePRFSetupRoute,
  rewrapStalePasskeyRoute,
  rotateMasterKeyRoute,
  verifyPRFSetupRoute,
  verifyRecoveryPhraseRoute,
} from "./user-encryption.route.ts";
import {
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
} from "@handlers/user-encryption/index.ts";

const app = createRateLimitedApp();

// =====================================
// User Encryption Routes
// =====================================

app.openapi(enhancedEncryptionOptInRoute, enhancedEncryptionOptInHandler);
app.openapi(enhancedEncryptionOptInPasskeyRoute, enhancedEncryptionOptInPasskeyHandler);
app.openapi(checkEncryptionStatusRoute, checkEncryptionStatusHandler);
app.openapi(verifyRecoveryPhraseRoute, verifyRecoveryPhraseHandler);
app.openapi(disableEnhancedEncryptionRoute, disableEnhancedEncryptionHandler);
app.openapi(canEnableEncryptionRoute, canEnableEncryptionHandler);
app.openapi(initiatePRFSetupRoute, initiatePRFSetupHandler);
app.openapi(verifyPRFSetupRoute, verifyPRFSetupHandler);
app.openapi(rotateMasterKeyRoute, rotateMasterKeyHandler);
app.openapi(rewrapStalePasskeyRoute, rewrapStalePasskeyHandler);

export default app;
