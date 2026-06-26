import { join } from "jsr:@std/path";
import { TextTransformations } from "@utils/text/index.ts";

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function generateService(name: string, directory?: string) {
  const camelCaseName = TextTransformations.toCamelCase(name);

  const serviceDir = directory ? join("services", directory) : join("services", name);
  const fileName = `${name}.service.ts`;
  const serviceFile = join(serviceDir, fileName);
  const serviceTemplate = `// Service logic for ${camelCaseName} module

export class ${capitalize(camelCaseName)}Service {
  // TODO: Implement service methods
}
`;
  await Deno.mkdir(serviceDir, { recursive: true });
  try {
    await Deno.stat(serviceFile);
    console.error(`File already exists: ${serviceFile}`);
  } catch {
    await Deno.writeTextFile(serviceFile, serviceTemplate);
    console.log(`Created: ${serviceFile}`);
  }
}
