// verify_deps.ts
//
// Fails CI if any source file imports a remote/npm/jsr/bare third-party
// specifier directly instead of going through deps.ts (aliased "@deps").
//
// Run with: deno run --allow-read .agents/skills/deno-backend/scripts/verify_deps.ts
//
// NOTE: this script has ZERO third-party imports (uses only the Deno runtime
// API) so it abides by the very policy it enforces and needs no import map.

/** Recursively yields *.ts file paths under `dir`, skipping `SKIP_DIRS`. */
async function* walkTs(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkTs(path);
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      yield path;
    }
  }
}

/** Source directories to enforce the deps policy on. Adjust per project. */
const SOURCE_DIRS = [
  "config",
  "constants",
  "db",
  "handlers",
  "interfaces",
  "jobs",
  "libs",
  "middleware",
  "models",
  "routes",
  "services",
  "utils",
];

/** Files allowed to contain raw specifiers (the central dependency module). */
const ALLOWED = new Set(["deps.ts", "src/deps.ts"]);

/** Directories to skip entirely. */
const SKIP_DIRS = new Set(["node_modules", "admin-ui", "static", "tests", "seed"]);

// Matches a raw protocol specifier in an import/export ... from "..." clause:
//   from "npm:...", "jsr:...", "https://...", "http://..."
const PROTOCOL = /\bfrom\s+["'](?:npm:|jsr:|https?:)/;

// Matches a dynamic import with a raw protocol specifier.
const DYNAMIC = /\bimport\s*\(\s*["'](?:npm:|jsr:|https?:)/;

let failed = false;
let scanned = 0;

for (const dir of SOURCE_DIRS) {
  let exists = true;
  try {
    await Deno.stat(dir);
  } catch {
    exists = false;
  }
  if (!exists) continue;

  for await (const path of walkTs(dir)) {
    const rel = path.replace(/^\.\//, "");
    if (ALLOWED.has(rel)) continue;

    scanned++;
    const text = await Deno.readTextFile(path);
    text.split("\n").forEach((line, i) => {
      if (PROTOCOL.test(line) || DYNAMIC.test(line)) {
        console.error(`❌ ${rel}:${i + 1} — import via @deps (deps.ts) instead:`);
        console.error(`     ${line.trim()}`);
        failed = true;
      }
    });
  }
}

if (failed) {
  console.error(`\nDependency policy violated (scanned ${scanned} files).`);
  console.error("All third-party imports must route through deps.ts (@deps).");
  Deno.exit(1);
}

console.log(`✅ All imports route through @deps (scanned ${scanned} files).`);
