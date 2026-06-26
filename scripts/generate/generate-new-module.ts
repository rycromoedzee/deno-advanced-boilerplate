// Usage: deno run --allow-read --allow-write scripts/generate-new-module.ts <module-name>
import { generateRoute } from "./generate-route.ts";
import { generateHandler } from "./generate-handler.ts";
import { generateService } from "./generate-service.ts";

if (import.meta.main) {
  const [moduleName] = Deno.args;
  if (!moduleName) {
    console.error(
      "Module name is required. Usage: deno run --allow-read --allow-write scripts/generate-new-module.ts <module-name>",
    );
    Deno.exit(1);
  }

  // Generate files using the new modular generators
  await generateRoute(moduleName);
  await generateHandler(moduleName);
  await generateService(moduleName);
}
