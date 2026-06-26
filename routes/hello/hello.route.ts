/**
 * @file routes/hello/hello.route.ts
 * @description Hello route definition
 */
import { createRoute, z } from "@deps";

const HelloQuerySchema = z.object({
  name: z.string().openapi({ description: "Name to greet", example: "Alice" }),
});

const HelloResponseSchema = z.object({
  message: z.string().openapi({
    description: "Greeting message",
    example: "sup Alice",
  }),
});

export const helloRoute = createRoute({
  method: "get",
  path: "/hello",
  summary: "Hello greeting",
  operationId: "helloGet",
  description: `Return a simple greeting for the given name.

**Behavior:** Echoes the \`name\` query parameter back in a \`message\` field (e.g. \`"sup Alice"\`).
**Auth:** public
**Permissions:** none
**Notes:** Sample route. **Currently unmounted** — \`routes/hello/\` is not imported or wired in \`main.ts\`, so this operation does not appear in the rendered OpenAPI spec.`,
  security: [],
  request: {
    query: HelloQuerySchema,
  },
  responses: {
    200: {
      description: "Greeting response",
      content: {
        "application/json": {
          schema: HelloResponseSchema,
        },
      },
    },
  },
});
