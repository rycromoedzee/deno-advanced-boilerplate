/**
 * @file handlers/hello/hello.handler.ts
 * @description Hello request handler
 */
import { z } from "@deps";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { helloRoute } from "@routes/hello/hello.route.ts";
import { loggerAppSections } from "@logger/index.ts";
import { TIMING_PROFILES } from "@utils/shared/timing.ts";

const SchemaHelloResponse = z.object({
  message: z.string(),
});

export const helloHandler = defineHandler(
  {
    route: helloRoute,
    operationName: "hello_greeting",
    entityType: "hello",
    loggerSection: loggerAppSections.INTERNAL,
    timingProfile: TIMING_PROFILES.FAST,
    authContext: false,
    responseSchema: SchemaHelloResponse,
  },
  // Handler must return Promise<HandlerResponse> per defineHandler's contract.
  // deno-lint-ignore require-await
  async ({ query }) => {
    const name = (query as { name?: string }).name;

    return {
      status: 200 as const,
      data: {
        message: `sup ${name}`,
      },
    };
  },
);
