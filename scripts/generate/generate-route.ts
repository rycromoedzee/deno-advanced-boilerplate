import { join } from "jsr:@std/path";
import { TextTransformations } from "@utils/index.ts";

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function generateRoute(name: string, directory?: string) {
  const camelCaseName = TextTransformations.toCamelCase(name);
  const fileName = `${name}.route.ts`;
  const routeDir = directory ? join("routes", directory) : "routes";
  const routeFile = join(routeDir, fileName);
  const routeTemplate = `
import { createRoute, z } from "@deps";
import { withDefaultResponses } from "@utils/open-api-shared-responses.ts";
import { ${camelCaseName}Handler } from "@handlers/${camelCaseName}.handler.ts";

const ${capitalize(camelCaseName)}QuerySchema = z.object({
  email: z.string().email().openapi({
    description: "User's email address",
    example: "user@example.com"
  }),
  password: z.string().min(6).openapi({
    description: "User's password",
    example: "password123"
  })

});

const ${capitalize(camelCaseName)}ResponseSchema = z.object({
  // Add response fields here
});

export const ${camelCaseName}Route = createRoute({
  method: "get",
  path: "/${camelCaseName}",
  tags: ["APP_SECTION"],
  summary: "User login",
  description: "Authenticate user and create session cookie",
  request: {
    query: ${capitalize(camelCaseName)}QuerySchema,
  },
  responses: withDefaultResponses({
    200: {
      description: "Response",
      content: {
        "application/json": {
          schema: ${capitalize(camelCaseName)}ResponseSchema,
        },
      },
    },
  }),
});

export { ${camelCaseName}Handler };
`;
  await Deno.mkdir(routeDir, { recursive: true });
  try {
    await Deno.stat(routeFile);
    console.error(`File already exists: ${routeFile}`);
  } catch (e) {
    await Deno.writeTextFile(routeFile, routeTemplate);
    console.log(`Created: ${routeFile}`);
    console.log(`Error: ${e}`);
  }
}
