/**
 * @file routes/webhooks/index.ts
 * @description Webhook routes
 */

import { OpenAPIHono } from "@deps";
import { emailStatusRoute } from "./webhooks.route.ts";
import { emailStatusHandler } from "@handlers/webhooks/index.ts";

const webhooksApp = new OpenAPIHono();

webhooksApp.openapi(emailStatusRoute, emailStatusHandler);

export default webhooksApp;
