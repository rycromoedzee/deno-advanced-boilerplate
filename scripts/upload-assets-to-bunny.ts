/**
 * @file scripts/upload-assets-to-bunny.ts
 * @description
 * Uploads static asset files (images, SVGs, etc.) from specified local directories to Bunny.net storage, preserving directory structure under /assets/<directoryName>.
 * Usage: Run with Deno to sync local asset folders to Bunny.net. Configure ASSET_DIRS for each asset section.
 * Output/Side Effects: Uploads new files to Bunny.net storage; skips files that already exist. Logs actions to console.
 * Deno Permissions: --allow-read (for reading local files), --allow-net (for Bunny.net API requests), --allow-env (for reading envConfig).
 */

import { walk } from "jsr:@std/fs@^0.224.0";
import { join, relative } from "jsr:@std/path@^0.224.0";
import { loadSync } from "https://deno.land/std@0.220.1/dotenv/mod.ts";

loadSync({ export: true, allowEmptyValues: true });

const env = {
  name: Deno.env.get("STORAGE_PUBLIC_NAME"),
  host: Deno.env.get("STORAGE_PUBLIC_HOST"),
  key: Deno.env.get("STORAGE_PUBLIC_KEY"),
};
// === CONFIG ===
const ASSET_DIRS = [
  { directoryName: "mail", route: "static/mail/assets" },
  // Add more as needed
];
const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

/**
 * Recursively fetches all file paths from Bunny.net storage under the given directory.
 * @param {string} dir Directory path relative to the storage root.
 * @returns {Promise<Set<string>>} Set of file paths relative to the storage root.
 */
async function getAllBunnyFiles(dir = ""): Promise<Set<string>> {
  const files = new Set<string>();
  const url = `https://${env.host}/${env.name}/${dir}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "AccessKey": env.key! },
  });
  if (!res.ok) return files;
  const items = await res.json();
  for (const item of items) {
    if (item.IsDirectory) {
      const subDir = dir ? `${dir}/${item.ObjectName}` : item.ObjectName;
      for (const f of await getAllBunnyFiles(subDir)) files.add(f);
    } else {
      const filePath = dir ? `${dir}/${item.ObjectName}` : item.ObjectName;
      files.add(filePath);
    }
  }
  return files;
}

/**
 * Uploads a local file to Bunny.net storage at the specified remote path.
 * @param {string} localPath Local filesystem path.
 * @param {string} remotePath Remote path in Bunny.net storage (relative to storage root).
 * @throws Error if upload fails.
 */
async function uploadFileToBunny(localPath: string, remotePath: string) {
  const url = `https://${env.host}/${env.name}/${remotePath}`;
  const file = await Deno.readFile(localPath);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "AccessKey": env.key!,
      "Content-Type": "application/octet-stream",
      "Content-Length": file.byteLength.toString(),
    },
    body: file,
  });
  if (!res.ok) {
    throw new Error(
      `Failed to upload ${localPath} to ${remotePath}: ${res.status} ${await res
        .text()}`,
    );
  }
}

// Main logic
const remoteFiles = await getAllBunnyFiles();
for (const { directoryName, route } of ASSET_DIRS) {
  for await (const entry of walk(route, { includeDirs: false })) {
    if (!ALLOWED_EXT.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      continue;
    }
    const relPath = relative(route, entry.path);
    const remotePath = join("assets/resources", directoryName, "assets", relPath).replace(
      /\\/g,
      "/",
    );
    if (remoteFiles.has(remotePath)) {
      console.log(`Skipping (already exists): ${remotePath}`);
      continue;
    }
    await uploadFileToBunny(entry.path, remotePath);
    console.log(`Uploaded: ${remotePath}`);
  }
}
