import { generateRoute } from "./generate-route.ts";
import { generateHandler } from "./generate-handler.ts";
import { generateService } from "./generate-service.ts";

function usage() {
  console.error(
    "Usage: deno run --allow-read --allow-write scripts/generate.ts <type> <name> [directory]",
  );
  console.error(
    "  <type>: route | handler | service | all",
  );
  Deno.exit(1);
}

if (import.meta.main) {
  const [type, name, directory] = Deno.args;
  if (!type || !name) usage();

  switch (type) {
    case "route":
      await generateRoute(name, directory);
      break;
    case "handler":
      await generateHandler(name, directory);
      break;
    case "service":
      await generateService(name, directory);
      break;
    case "all":
      await generateRoute(name, directory);
      await generateHandler(name, directory);
      await generateService(name, directory);
      break;
    default:
      usage();
  }
}
