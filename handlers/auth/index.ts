/**
 * @file handlers/auth/index.ts
 * @description Barrel for auth handlers (mirrors routes/auth/).
 *
 * Route ↔ handler mirror (1:1, operation-heavy auth domain):
 *   challenge.handler.ts   ↔ challenge.route.ts
 *   login.handler.ts       ↔ login.route.ts
 *   logout.handler.ts      ↔ logout.route.ts
 *   magic.handler.ts       ↔ magic.route.ts
 *   passkey.handler.ts     ↔ passkey.route.ts
 *   recovery.handler.ts    ↔ recovery.route.ts
 *   refresh.handler.ts     ↔ refresh.route.ts
 *   register.handler.ts    ↔ register.route.ts
 *   two-factor.handler.ts  ↔ two-factor.route.ts
 */

export { authChallengeHandler } from "./challenge.handler.ts";
export { authLoginHandler } from "./login.handler.ts";
export { authLogoutHandler } from "./logout.handler.ts";
export { magicLinkConsumeHandler, magicLinkRequestHandler } from "./magic.handler.ts";
export { passkeyLoginBeginHandler, passkeyLoginVerifyHandler } from "./passkey.handler.ts";
export {
  recoveryBeginHandler,
  recoveryDisable2FAHandler,
  recoveryResetPasswordHandler,
  recoverySendResetEmailHandler,
  recoveryVerifyBackupCodeHandler,
  recoveryVerifyEmailTokenHandler,
  recoveryVerifyPhraseHandler,
} from "./recovery.handler.ts";
export { authRefreshHandler } from "./refresh.handler.ts";
export { registerHandler, registerPasskeyVerifyHandler, registerValidateHandler } from "./register.handler.ts";
export { twoFactorAuthHandler } from "./two-factor.handler.ts";
