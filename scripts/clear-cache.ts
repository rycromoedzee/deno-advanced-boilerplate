#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --unstable-kv

/**
 * Cache Clearing Utility
 *
 * This script provides options to clear specific namespaces or all cache entries
 * from your Deno KV store.
 */

import { CACHE_NAMESPACES, getCache } from "../services/cache/index.ts";
import { getEmailTemplateService } from "../services/mailer/index.ts";

interface ClearOptions {
  namespace?: string;
  pattern?: string;
  all?: boolean;
  emailTemplates?: boolean;
  dryRun?: boolean;
}

/**
 * Clear specific cache namespace
 */
async function clearNamespace(
  namespaceName: string,
  dryRun = false,
): Promise<void> {
  const cache = await getCache();

  console.log(
    `${dryRun ? "[DRY RUN] " : ""}Clearing namespace: ${namespaceName}`,
  );

  try {
    // Get stats before clearing
    const statsBefore = await cache.getStats(namespaceName);
    console.log(`  - Entries before: ${statsBefore.entryCount}`);
    console.log(
      `  - Total size: ${(statsBefore.totalSize / 1024).toFixed(2)} KB`,
    );

    if (!dryRun) {
      await cache.clearNamespace(namespaceName);
      console.log(`✅ Cleared namespace: ${namespaceName}`);
    } else {
      console.log(`🔍 Would clear namespace: ${namespaceName}`);
    }
  } catch (error) {
    console.error(`❌ Error clearing namespace ${namespaceName}:`, error);
  }
}

/**
 * Clear all cache entries
 */
async function clearAllCache(dryRun = false): Promise<void> {
  const cache = await getCache();

  console.log(`${dryRun ? "[DRY RUN] " : ""}Clearing ALL cache entries...`);

  try {
    // Get all namespaces
    const namespaces = await cache.getAllNamespaces();
    console.log(`Found ${namespaces.length} namespaces to clear:`);

    for (const namespace of namespaces) {
      await clearNamespace(namespace, dryRun);
    }

    if (!dryRun) {
      console.log(
        `🎉 Successfully cleared all ${namespaces.length} namespaces!`,
      );
    } else {
      console.log(`🔍 Would clear all ${namespaces.length} namespaces`);
    }
  } catch (error) {
    console.error("❌ Error clearing all cache:", error);
  }
}

/**
 * List all cache namespaces and their stats
 */
async function listCacheStats(): Promise<void> {
  const cache = await getCache();

  console.log("📊 Cache Statistics:");
  console.log("==================");

  try {
    const namespaces = await cache.getAllNamespaces();

    if (namespaces.length === 0) {
      console.log("No cache entries found.");
      return;
    }

    let totalEntries = 0;
    let totalSize = 0;

    for (const namespace of namespaces) {
      const stats = await cache.getStats(namespace);
      totalEntries += stats.entryCount;
      totalSize += stats.totalSize;

      console.log(`\n📂 ${namespace}:`);
      console.log(`   Entries: ${stats.entryCount}`);
      console.log(`   Size: ${(stats.totalSize / 1024).toFixed(2)} KB`);
      console.log(`   Hit Rate: ${(stats.hitRate * 100).toFixed(1)}%`);
      console.log(`   Hits/Misses: ${stats.hits}/${stats.misses}`);
    }

    console.log(
      `\n🔢 Total: ${totalEntries} entries, ${(totalSize / 1024).toFixed(2)} KB`,
    );
  } catch (error) {
    console.error("❌ Error getting cache stats:", error);
  }
}

/**
 * Clear threat intelligence specific caches
 */
async function clearThreatIntelCache(dryRun = false): Promise<void> {
  console.log(
    `${dryRun ? "[DRY RUN] " : ""}Clearing Threat Intelligence caches...`,
  );

  // Get all threat intelligence namespaces dynamically
  const threatNamespaces = Object.values(CACHE_NAMESPACES.THREAT_INTELLIGENCE);

  for (const namespace of threatNamespaces) {
    await clearNamespace(namespace, dryRun);
  }
}

/**
 * Clear email template caches (L1 in-memory + L2 DenoKV "email-templates" namespace).
 * This is separate from the application data cache and must be cleared explicitly
 * when email template files or assets are updated.
 */
async function clearEmailTemplateCache(dryRun = false): Promise<void> {
  console.log(
    `${dryRun ? "[DRY RUN] " : ""}Clearing email template cache...`,
  );

  if (dryRun) {
    console.log(
      `🔍 Would clear: L1 in-memory compiled templates, L1 project variables, L1 locale cache, L2 KV namespace "email-templates"`,
    );
    return;
  }

  try {
    const emailTemplateService = getEmailTemplateService();
    await emailTemplateService.clearTemplateCache();
    console.log(`✅ Cleared email template cache (L1 + L2 KV "email-templates")`);
  } catch (error) {
    console.error("❌ Error clearing email template cache:", error);
  }
}

/**
 * Main function
 */
async function main() {
  const args = Deno.args;
  const options: ClearOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--all":
        options.all = true;
        break;
      case "--namespace":
        options.namespace = args[i + 1];
        i++; // Skip next argument
        break;
      case "--email-templates":
        options.emailTemplates = true;
        break;
      case "--threat-intel":
        options.namespace = "threat-intelligence";
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--stats":
      case "--list":
        await listCacheStats();
        // Close cache and exit for stats-only operations
        try {
          const cache = await getCache();
          await cache.close();
        } catch (error) {
          console.error("Error closing cache:", error);
        }
        Deno.exit(0);
        break;
      case "--help":
      case "-h":
        printHelp();
        Deno.exit(0);
        break;
      default:
        if (args[i].startsWith("--")) {
          console.error(`Unknown option: ${args[i]}`);
          printHelp();
          Deno.exit(1);
        }
    }
  }

  // Execute based on options
  try {
    if (options.all) {
      await clearAllCache(options.dryRun);
      await clearEmailTemplateCache(options.dryRun);
    } else if (options.emailTemplates) {
      await clearEmailTemplateCache(options.dryRun);
    } else if (options.namespace === "threat-intelligence") {
      await clearThreatIntelCache(options.dryRun);
    } else if (options.namespace) {
      await clearNamespace(options.namespace, options.dryRun);
    } else {
      console.log("No action specified. Use --help for usage information.");
      console.log("\nQuick stats:");
      await listCacheStats();
    }
  } catch (error) {
    console.error("❌ Error:", error);
    Deno.exit(1);
  }

  // Close cache connection and exit cleanly
  try {
    const cache = await getCache();
    await cache.close();
  } catch (error) {
    console.error("Error closing cache:", error);
  }

  // Force exit to prevent hanging
  Deno.exit(0);
}

/**
 * Print help information
 */
function printHelp() {
  // Dynamically get all cache namespaces
  const getAllNamespaces = () => {
    const allNamespaces: string[] = [];

    // Get all nested namespace values
    Object.values(CACHE_NAMESPACES).forEach((category) => {
      if (typeof category === "object") {
        allNamespaces.push(...Object.values(category));
      } else {
        allNamespaces.push(category);
      }
    });

    return allNamespaces.sort();
  };

  const availableNamespaces = getAllNamespaces();

  console.log(`
🧹 Cache Clearing Utility

USAGE:
  deno run --allow-read --allow-write --allow-env --unstable-kv scripts/clear-cache.ts [OPTIONS]

OPTIONS:
  --all                    Clear all cache entries (including email templates)
  --namespace <name>       Clear specific namespace
  --email-templates        Clear email template cache (L1 in-memory + L2 KV)
  --threat-intel          Clear all threat intelligence caches
  --dry-run               Show what would be cleared without actually clearing
  --stats, --list         List all cache namespaces and their statistics
  --help, -h              Show this help message

EXAMPLES:
  # List all cache entries and stats
  deno run --allow-read --allow-write --allow-env --unstable-kv scripts/clear-cache.ts --stats
  
  # Clear all cache entries (dry run first)
  deno run --allow-read --allow-write --allow-env --unstable-kv scripts/clear-cache.ts --all --dry-run
  deno run --allow-read --allow-write --allow-env --unstable-kv scripts/clear-cache.ts --all
  
  # Clear only email template cache (after updating templates or email assets)
  deno run --allow-read --allow-write --allow-env --unstable-kv scripts/clear-cache.ts --email-templates
  
  # Clear only threat intelligence caches
  deno run --allow-read --allow-write --allow-env --unstable-kv scripts/clear-cache.ts --threat-intel
  
  # Clear specific namespace
  deno run --allow-read --allow-write --allow-env --unstable-kv scripts/clear-cache.ts --namespace ip_lookup_cache

AVAILABLE NAMESPACES:
  ${availableNamespaces.join(", ")}

NAMESPACE CATEGORIES:
  • Threat Intelligence: ${Object.values(CACHE_NAMESPACES.THREAT_INTELLIGENCE).join(", ")}
  • Authentication: ${Object.values(CACHE_NAMESPACES.AUTH).join(", ")}
  • Permissions: ${Object.values(CACHE_NAMESPACES.PERMISSIONS).join(", ")}
  • Rate Limits: ${CACHE_NAMESPACES.RATE_LIMITS}
`);
}

// Run the script
if (import.meta.main) {
  await main();
}
