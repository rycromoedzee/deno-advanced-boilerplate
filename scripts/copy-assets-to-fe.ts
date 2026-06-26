/**
 * @file scripts/copy-assets-to-fe.ts
 * @description
 * Copies static asset files (images, SVGs, etc.) from specified local directories to the
 * frontend project's public folder, preserving directory structure under public/assets/<directoryName>.
 * Mirrors the same asset layout as upload-assets-to-bunny.ts so both targets stay in sync.
 * Usage: deno run --allow-read --allow-write scripts/copy-assets-to-fe.ts
 * Output/Side Effects: Copies new/updated files to the frontend public folder; logs actions to console.
 * Deno Permissions: --allow-read (source files), --allow-write (destination files).
 */

import { walk } from "jsr:@std/fs@^0.224.0";
import { dirname, join, relative } from "jsr:@std/path@^0.224.0";

// === CONFIG ===
// Resolve the FE public dir relative to the repo root (one level up from scripts/).
const REPO_ROOT = join(import.meta.dirname!, "..");
const FE_PUBLIC_DIR = join(REPO_ROOT, "../deno-boilerplate-fe/public");

const ASSET_DIRS = [
  { directoryName: "mail", route: "static/mail/assets" },
  // Add more as needed
];

const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

/**
 * Collects all existing file paths under a local directory into a Set,
 * relative to that directory root.
 * @param {string} dir Absolute or relative path to scan.
 * @returns {Promise<Set<string>>} Set of relative file paths.
 */
async function getLocalFiles(dir: string): Promise<Set<string>> {
  const files = new Set<string>();
  try {
    for await (const entry of walk(dir, { includeDirs: false })) {
      files.add(relative(dir, entry.path));
    }
  } catch {
    // Directory doesn't exist yet — that's fine, we'll create files as needed.
  }
  return files;
}

/**
 * Copies a local file to the destination path, creating parent directories as needed.
 * @param {string} srcPath Source filesystem path.
 * @param {string} destPath Destination filesystem path.
 */
async function copyFile(srcPath: string, destPath: string): Promise<void> {
  await Deno.mkdir(dirname(destPath), { recursive: true });
  await Deno.copyFile(srcPath, destPath);
}

// Main logic
const destBase = join("assets", "resources");
const existingFiles = await getLocalFiles(join(FE_PUBLIC_DIR, destBase));

for (const { directoryName, route } of ASSET_DIRS) {
  for await (const entry of walk(route, { includeDirs: false })) {
    if (!ALLOWED_EXT.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      continue;
    }

    const relPath = relative(route, entry.path).replaceAll("\\", "/");
    const destRelPath = join(destBase, directoryName, "assets", relPath).replaceAll("\\", "/");
    const destAbsPath = join(FE_PUBLIC_DIR, destRelPath);

    if (existingFiles.has(destRelPath)) {
      console.log(`Skipping (already exists): ${destRelPath}`);
      continue;
    }

    await copyFile(entry.path, destAbsPath);
    console.log(`Copied: ${destRelPath}`);
  }
}
