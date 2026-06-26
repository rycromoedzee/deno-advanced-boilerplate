/**
 * @file routes/debug/index.ts
 * @description Barrel/Hono app wiring for debug routes
 */
import { OpenAPIHono } from "@deps";
import { addMailToQueueRoute } from "./add-mail-to-queue.route.ts";
import { addMailToQueueHandler } from "@handlers/debug/index.ts";

const debug = new OpenAPIHono();

// Debug routes
debug.openapi(addMailToQueueRoute, addMailToQueueHandler);

export default debug;
