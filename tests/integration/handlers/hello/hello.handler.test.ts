import { assertEquals } from "@std/assert";
// Import the PRODUCTION wiring module — this mounts the real `helloHandler`, a
// `defineHandler`-wrapped handler (route + factory: timing, responseSchema.parse,
// error handling). A round-trip through it exercises route match → defineHandler
// factory → handler body → responseSchema.parse → response, i.e. the layered
// stack end-to-end. (Previously this tested an inline mock because importing the
// real handler triggered an import-time DB connection in OptimizedDataLoader;
// that side effect is now lazy, so the real handler imports cleanly.)
import helloApp from "@routes/hello/index.ts";

Deno.test("integration: real helloApp returns 200 with the greeting via the defineHandler stack", async () => {
  const res = await helloApp.request("/hello?name=Alice");
  assertEquals(res.status, 200);
  // defineHandler runs the handler body, then responseSchema.parse() on the data
  // — reaching this assertion means the full layered wiring held.
  assertEquals(await res.json(), { message: "sup Alice" });
});

Deno.test("integration: real helloApp rejects a missing required `name` with 400", async () => {
  // The route's declared zod query schema requires `name`; OpenAPIHono enforces
  // it before the handler runs, returning 400.
  const res = await helloApp.request("/hello");
  assertEquals(res.status, 400);
});
