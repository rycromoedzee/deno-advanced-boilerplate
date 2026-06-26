#!/usr/bin/env deno run --allow-net --allow-read --allow-write --unstable-kv

/**
 * Manual Threat Intelligence Update Script
 *
 * This script provides a manual way to trigger threat intelligence updates
 * for all active sources. It uses the same update service as the automated job system.
 *
 * NOTE: Under normal circumstances, you should use the automated job system
 * instead of running this script manually. This is provided as an override option
 * for initial setup or emergency updates.
 *
 * Normal workflow:
 * 1. Run seed-threat-sources.ts once to initialize sources
 * 2. Let the automated job (threat-intelligence-sources.job.ts) handle updates
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write --unstable-kv scripts/threats/update-combined-threats.ts
 *
 * What this does:
 * - Fetches all active threat sources from the database
 * - Updates each source using the threat-source-update.service
 * - Uses the same configurations as the automated job system
 */

import { getThreatSourceUpdateService } from "@services/threat-intelligence/singletons.ts";

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    console.log("🚀 Starting manual threat intelligence update...");
    console.log("📋 This will update all active threat sources in the database");
    console.log("");

    const startTime = performance.now();

    // Use the same update service as the automated job
    const results = await getThreatSourceUpdateService().updateAllSources();

    const totalDuration = performance.now() - startTime;
    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const totalAdded = results.reduce((sum, r) => sum + r.entriesAdded, 0);
    const totalUpdated = results.reduce((sum, r) => sum + r.entriesUpdated, 0);
    const totalRemoved = results.reduce((sum, r) => sum + r.entriesRemoved, 0);

    console.log("\n🎉 Manual threat intelligence update complete!");
    console.log("📊 Summary:");
    console.log(`   Total duration: ${Math.round(totalDuration)}ms`);
    console.log(`   Sources updated: ${successCount}/${results.length}`);
    console.log(`   Failed: ${failedCount}`);
    console.log(`   Entries added: ${totalAdded}`);
    console.log(`   Entries updated: ${totalUpdated}`);
    console.log(`   Entries removed: ${totalRemoved}`);

    console.log("\n📋 Per-source results:");
    results.forEach((result) => {
      const icon = result.status === "success" ? "✅" : "❌";
      const duration = Math.round(result.durationMs);
      console.log(
        `   ${icon} ${result.sourceName}: +${result.entriesAdded} ~${result.entriesUpdated} -${result.entriesRemoved} (${duration}ms)`,
      );
      if (result.errorMessage) {
        console.log(`      Error: ${result.errorMessage}`);
      }
    });

    if (failedCount > 0) {
      console.log(
        "\n⚠️  Some sources failed to update. Check the logs above for details.",
      );
      Deno.exit(1);
    }
  } catch (error) {
    console.error("❌ Failed to run manual threat intelligence update:", error);
    Deno.exit(1);
  } finally {
    // Ensure cleanup happens regardless of success/failure
    try {
      console.log("\n🧹 Cleaning up connections...");
      // Give time for any pending operations to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (cleanupError) {
      console.warn("⚠️  Cleanup warning:", cleanupError);
    }
  }
}

// Run the script if executed directly
if (import.meta.main) {
  try {
    await main();
    console.log("\n🎯 Script completed successfully - exiting cleanly");
    Deno.exit(0);
  } catch (error) {
    console.error("❌ Script failed:", error);
    Deno.exit(1);
  }
}
