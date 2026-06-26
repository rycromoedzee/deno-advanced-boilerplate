/**
 * @file tests/unit/services/object-backup/catalog.test.ts
 * @description Integration tests for the object-backup catalog queries (DD1/DD2)
 * against an isolated, migrated tenant DB.
 *
 * Stands up a fresh libSQL file DB, applies the FULL tenant migration chain
 * (so the `backed_up_at` / `thumbnail_backed_up_at` columns exist), and
 * exercises selection + marking: rows are selected only while un-backed, the
 * separate thumbnail flag retries independently, ordering is by createdAt, and
 * the batch limit is honoured.
 */
import { assertEquals } from "@std/assert";
import { createNodeClient, drizzle, eq, migrate } from "@deps";
import * as tenantSchema from "@db/schema/tenant/index.ts";
import { tenantTables } from "@db/index.ts";
import {
  markAttachmentBackedUp,
  markDocumentMainBackedUp,
  markDocumentThumbnailBackedUp,
  selectUnbackedAttachments,
  selectUnbackedDocuments,
} from "@services/object-backup/catalog.ts";

interface Handle {
  // deno-lint-ignore no-explicit-any
  db: any;
  client: { close: () => void };
  cleanup: () => Promise<void>;
}

async function makeTenantDb(): Promise<Handle> {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/tenant.db`;
  const client = createNodeClient({ url: `file:${file}` });
  // FKs OFF so we can insert catalog rows without their parent notes/user_profiles.
  await client.execute("PRAGMA foreign_keys = OFF");
  // deno-lint-ignore no-explicit-any
  const db: any = drizzle(client, { schema: tenantSchema });
  await migrate(db, { migrationsFolder: "./db/tenant-migrations" });
  return {
    db,
    client,
    cleanup: async () => {
      try {
        client.close();
      } catch { /* idempotent */ }
      await Deno.remove(dir, { recursive: true });
    },
  };
}

/** Insert a storage_metadata row; only the no-default NOT NULL fields are required. */
function insertDoc(
  h: Handle,
  id: string,
  opts: { createdAt: number; thumbnailPath?: string | null },
): Promise<unknown> {
  return h.db.insert(tenantTables.storageMetadata).values({
    id,
    originalName: `${id}.bin`,
    mimeType: "application/octet-stream",
    folderPath: `environment-storage/env/documents/${id}.bin`,
    userId: "u1",
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
    thumbnailPath: opts.thumbnailPath ?? null,
  });
}

function insertAttachment(h: Handle, id: string, createdAt: number): Promise<unknown> {
  return h.db.insert(tenantTables.noteAttachments).values({
    id,
    noteId: "n1",
    ownerId: "up1",
    mimeType: "image/png",
    originalName: `${id}.png`,
    storageKey: `environment-storage/env/notes/${id}.png`,
    createdAt,
  });
}

Deno.test("catalog: selectUnbackedDocuments returns backedUpAt-IS-NULL rows ordered by createdAt", async () => {
  const h = await makeTenantDb();
  try {
    await insertDoc(h, "sm3", { createdAt: 3000 });
    await insertDoc(h, "sm1", { createdAt: 1000 });
    await insertDoc(h, "sm2", { createdAt: 2000 });

    const rows = await selectUnbackedDocuments(h.db, 10);
    assertEquals(rows.map((r) => r.id), ["sm1", "sm2", "sm3"]);
    assertEquals(rows.every((r) => r.needsMain), true);
    assertEquals(rows.every((r) => r.needsThumbnail), false); // no thumbnails
  } finally {
    await h.cleanup();
  }
});

Deno.test("catalog: markDocumentMainBackedUp excludes a row from the main-needs set", async () => {
  const h = await makeTenantDb();
  try {
    await insertDoc(h, "sm1", { createdAt: 1000 });
    await insertDoc(h, "sm2", { createdAt: 2000 });

    await markDocumentMainBackedUp(h.db, "sm1", 9999);

    const rows = await selectUnbackedDocuments(h.db, 10);
    assertEquals(rows.map((r) => r.id), ["sm2"]);
  } finally {
    await h.cleanup();
  }
});

Deno.test("catalog: thumbnail backs up independently (thumbnailBackedUpAt is separate)", async () => {
  const h = await makeTenantDb();
  try {
    await insertDoc(h, "sm1", { createdAt: 1000, thumbnailPath: "environment-storage/env/documents/sm1-thumb.jpg" });

    // Main backed up, thumbnail not yet → still selected, needsThumbnail true.
    await markDocumentMainBackedUp(h.db, "sm1", 1000);
    let rows = await selectUnbackedDocuments(h.db, 10);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].needsMain, false);
    assertEquals(rows[0].needsThumbnail, true);
    assertEquals(rows[0].thumbnailPath, "environment-storage/env/documents/sm1-thumb.jpg");

    // Thumbnail backed up → fully excluded.
    await markDocumentThumbnailBackedUp(h.db, "sm1", 1001);
    rows = await selectUnbackedDocuments(h.db, 10);
    assertEquals(rows, []);
  } finally {
    await h.cleanup();
  }
});

Deno.test("catalog: batch limit is honoured (oldest first)", async () => {
  const h = await makeTenantDb();
  try {
    for (let i = 0; i < 5; i++) await insertDoc(h, `sm${i}`, { createdAt: 1000 + i });
    const rows = await selectUnbackedDocuments(h.db, 2);
    assertEquals(rows.map((r) => r.id), ["sm0", "sm1"]);
  } finally {
    await h.cleanup();
  }
});

Deno.test("catalog: selectUnbackedAttachments + markAttachmentBackedUp", async () => {
  const h = await makeTenantDb();
  try {
    // Satisfy note_attachments FKs (noteId->notes, ownerId->user_profiles).
    await h.db.insert(tenantTables.userProfiles).values({ userId: "up1" });
    await h.db.insert(tenantTables.notes).values({ id: "n1", ownerId: "up1", title: "t" });

    await insertAttachment(h, "na2", 2000);
    await insertAttachment(h, "na1", 1000);

    let rows = await selectUnbackedAttachments(h.db, 10);
    assertEquals(rows.map((r) => r.id), ["na1", "na2"]);
    assertEquals(rows[0].storageKey, "environment-storage/env/notes/na1.png");

    await markAttachmentBackedUp(h.db, "na1", 5000);
    rows = await selectUnbackedAttachments(h.db, 10);
    assertEquals(rows.map((r) => r.id), ["na2"]);
  } finally {
    await h.cleanup();
  }
});

Deno.test("catalog: the backed_up_at columns exist (migration applied)", async () => {
  // Indirect proof: the queries above would throw if the columns were missing.
  // Additionally confirm a marked value round-trips through a direct read.
  const h = await makeTenantDb();
  try {
    await insertDoc(h, "sm1", { createdAt: 1000 });
    await markDocumentMainBackedUp(h.db, "sm1", 4242);
    const [row] = await h.db.select().from(tenantTables.storageMetadata).where(eq(tenantTables.storageMetadata.id, "sm1"));
    assertEquals(row.backedUpAt, 4242);
    assertEquals(row.thumbnailBackedUpAt, null);
  } finally {
    await h.cleanup();
  }
});
