/**
 * Seed Threat Sources Script
 *
 * Reconciles the threatSources table with the single source of truth in
 * @constants/threat-intelligence.ts:
 *   - Inserts sources that don't exist yet (by name).
 *   - Updates config-derived fields (description, url, isActive, updateFrequency)
 *     on existing sources so edits in the constants actually propagate.
 *   - Deactivates (isActive=false) DB rows whose name is no longer present in
 *     THREAT_SOURCES, so removals take effect WITHOUT deleting historical
 *     threat IPs/CIDRs (the lookup/bloom queries join on threatSources.isActive,
 *     so deactivation is sufficient to drop them from detection while keeping
 *     the data and FK integrity for a possible later re-activation).
 *
 * `totalEntries` is owned by the update service and is never touched here.
 *
 * Usage:
 *   deno run --allow-env --allow-net --allow-read scripts/threats/seed-threat-sources.ts
 */

import { eq, inArray } from "@deps";
import { threatSources } from "@db/schema/global/threat-intelligence.ts";
import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { getWorkerDB } from "@db/index.ts";
import { THREAT_SOURCES } from "@constants/threat-intelligence.ts";

async function seedThreatSources() {
  const db = getWorkerDB();

  console.log("🌱 Starting threat sources seed (reconcile mode)...\n");

  const now = Math.floor(Date.now() / 1000);
  const configNames = new Set(THREAT_SOURCES.map((s) => s.name));

  let addedCount = 0;
  let updatedCount = 0;
  let deactivatedCount = 0;

  await db.transaction(async (tx) => {
    // Snapshot existing rows once so we can decide insert vs. update and detect
    // orphans (rows present in DB but absent from the constants) in memory.
    const existingRows = await tx
      .select({ id: threatSources.id, name: threatSources.name, isActive: threatSources.isActive })
      .from(threatSources);
    const existingByName = new Map(existingRows.map((r) => [r.name, r]));

    // 1. Upsert every configured source.
    for (const source of THREAT_SOURCES) {
      const existing = existingByName.get(source.name);

      if (!existing) {
        await tx.insert(threatSources).values({
          id: generateIdRandomWithTimestamp(16),
          name: source.name,
          description: source.description,
          url: source.url,
          isActive: source.isActive,
          updateFrequency: source.updateFrequency,
          totalEntries: 0,
        });
        console.log(`✅ Added "${source.name}" (updates every ${source.updateFrequency}h)`);
        addedCount++;
        continue;
      }

      // Refresh config-derived fields; leave totalEntries to the update service.
      await tx
        .update(threatSources)
        .set({
          description: source.description,
          url: source.url,
          isActive: source.isActive,
          updateFrequency: source.updateFrequency,
          updatedAt: now,
        })
        .where(eq(threatSources.id, existing.id));
      console.log(`♻️  Updated "${source.name}"`);
      updatedCount++;
    }

    // 2. Reconcile removals: deactivate active rows no longer in the constants.
    //    We deactivate (not delete) to preserve threat IPs/CIDRs and FK links.
    const orphanActive = existingRows.filter(
      (r) => !configNames.has(r.name) && r.isActive,
    );

    if (orphanActive.length > 0) {
      await tx
        .update(threatSources)
        .set({ isActive: false, updatedAt: now })
        .where(inArray(threatSources.id, orphanActive.map((r) => r.id)));

      for (const orphan of orphanActive) {
        console.log(`🚫 Deactivated "${orphan.name}" (removed from THREAT_SOURCES)`);
      }
      deactivatedCount = orphanActive.length;
    }
  });

  console.log(`\n📊 Summary:`);
  console.log(`   Added:        ${addedCount}`);
  console.log(`   Updated:      ${updatedCount}`);
  console.log(`   Deactivated:  ${deactivatedCount}`);
  console.log(`   Config total: ${THREAT_SOURCES.length}`);
  console.log(`\n✅ Seed complete!`);
}

// Run the seed. getWorkerDB() holds open DB/pool handles that keep the event
// loop alive, so exit explicitly once the work has committed.
try {
  await seedThreatSources();
  Deno.exit(0);
} catch (error) {
  console.error("❌ Seed failed:", error);
  Deno.exit(1);
}
