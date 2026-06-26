import { join } from "jsr:@std/path";
import { TextTransformations } from "@utils/index.ts";

export async function generateHandler(name: string, directory?: string) {
  const camelCaseName = TextTransformations.toCamelCase(name);
  const fileName = `${name}.handler.ts`;
  const handlerDir = directory ? join("handlers", directory) : "handlers";
  const handlerFile = join(handlerDir, fileName);
  const handlerTemplate = `import type { HonoContext } from "@deps";
import { HTTPException } from "@deps";
import {throwHttpError} from "@utils/http-exception.ts";
import { 
  loggerAppSections, 
  useLogger, 
  LoggerLevels,
  useLogSecurityEvent,
  useLogPerformance
} from "@logger/logger.ts";
// import { SomeService } from "@services/${name}.service.ts";

/**
 * Handler for \${capitalize(camelCaseName)} endpoint
 */
export const ${camelCaseName}Handler = async (c: HonoContext) => {
  try {
    // Validate HTTP method
    if (c.req.method !== "GET") {
      await useLogger(LoggerLevels.warn, {
        messageKey: 'http.method-invalid',
        section: loggerAppSections,
        message: \`HTTP => Invalid method provided to \${c.req.path}\`,
        details: { method: c.req.method, expected: "GET" },
      });
      throwHttpError("COMMON.METHOD_NOT_ALLOWED")
    }
    // TODO: Implement handler logic
    return c.json({ message: \`Hello from ${camelCaseName}!\` }), 200;
  } catch (e) {
    await useLogger("error", { 
      messageKey: 'http.handler-error',
      section: loggerAppSections,
      message: "HTTP => Error occurred in handler",
      details: { method: c.req.method, expected: "GET" },
      raw: e
    });
    throwHttpError("COMMON.INTERNAL_SERVER_ERROR")
  }
};
`;
  await Deno.mkdir(handlerDir, { recursive: true });
  try {
    await Deno.stat(handlerFile);
    console.error(`File already exists: ${handlerFile}`);
  } catch {
    await Deno.writeTextFile(handlerFile, handlerTemplate);
    console.log(`Created: ${handlerFile}`);
  }
}
