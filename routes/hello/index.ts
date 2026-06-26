/**
 * @file routes/hello/index.ts
 * @description Hello/sample feature — wiring module
 *
 * Sample greeting endpoint (no auth). Kept as a minimal feature folder so the
 * routes tree has no loose root route files.
 */

import { OpenAPIHono } from "@deps";
import { helloRoute } from "./hello.route.ts";
import { helloHandler } from "@handlers/hello/index.ts";

const helloApp = new OpenAPIHono();

helloApp.openapi(helloRoute, helloHandler);

export default helloApp;
