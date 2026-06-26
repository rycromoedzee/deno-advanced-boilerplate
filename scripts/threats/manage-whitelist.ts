#!/usr/bin/env deno run --allow-net --allow-read --allow-write

/**
 * Whitelist Management Script
 *
 * This script allows you to manage the IP whitelist for threat intelligence.
 * IPs and CIDR blocks in the whitelist will be allowed even if they appear
 * in threat intelligence sources.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write scripts/manage-whitelist.ts [action] [ip/cidr] [reason]
 *
 * Actions:
 *   add-ip [ip] [reason]           - Add an IP to whitelist
 *   add-cidr [cidr] [reason]       - Add a CIDR block to whitelist
 *   remove-ip [ip]                 - Remove an IP from whitelist
 *   remove-cidr [cidr]             - Remove a CIDR block from whitelist
 *   list                           - List all whitelisted entries
 *   check [ip]                     - Check if IP is whitelisted or would be a threat
 *   stats                          - Show whitelist statistics
 *
 * Examples:
 *   scripts/manage-whitelist.ts add-ip 192.168.1.100 "Office static IP"
 *   scripts/manage-whitelist.ts add-cidr 10.0.0.0/8 "Internal network"
 *   scripts/manage-whitelist.ts check 8.8.8.8
 *   scripts/manage-whitelist.ts list
 */

import { getThreatIntelligenceService } from "@services/threat-intelligence/index.ts";
import { IPValidationUtils } from "@utils/network/ip-validation.ts";

// Using IPValidationUtils instead of local validation functions

/**
 * Show usage information
 */
function showUsage() {
  console.log("🛡️  Threat Intelligence Whitelist Manager");
  console.log("=========================================");
  console.log("");
  console.log(
    "Usage: deno run --allow-net --allow-read --allow-write scripts/manage-whitelist.ts [action] [args...]",
  );
  console.log("");
  console.log("Actions:");
  console.log("  add-ip [ip] [reason]           Add an IP to whitelist");
  console.log("  add-cidr [cidr] [reason]       Add a CIDR block to whitelist");
  console.log("  remove-ip [ip]                 Remove an IP from whitelist");
  console.log(
    "  remove-cidr [cidr]             Remove a CIDR block from whitelist",
  );
  console.log("  list                           List all whitelisted entries");
  console.log(
    "  check [ip]                     Check if IP is whitelisted or would be a threat",
  );
  console.log("  stats                          Show whitelist statistics");
  console.log("");
  console.log("Examples:");
  console.log(
    '  scripts/manage-whitelist.ts add-ip 192.168.1.100 "Office static IP"',
  );
  console.log(
    '  scripts/manage-whitelist.ts add-cidr 10.0.0.0/8 "Internal network"',
  );
  console.log("  scripts/manage-whitelist.ts check 8.8.8.8");
  console.log("  scripts/manage-whitelist.ts list");
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  const args = Deno.args;

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showUsage();
    return;
  }

  const action = args[0];
  const threatIntelligenceService = getThreatIntelligenceService();

  try {
    // Initialize threat intelligence service
    console.log("🛡️  Initializing threat intelligence...");
    await threatIntelligenceService.initialize();

    switch (action) {
      case "add-ip": {
        const ip = args[1];
        const reason = args[2];

        if (!ip) {
          console.error("❌ IP address is required");
          console.log(
            "Usage: scripts/manage-whitelist.ts add-ip [ip] [reason]",
          );
          Deno.exit(1);
        }

        if (!IPValidationUtils.isValidIP(ip)) {
          console.error(`❌ Invalid IP address: ${ip}`);
          Deno.exit(1);
        }

        await threatIntelligenceService.addToWhitelist(
          ip,
          reason || "Added via CLI",
          "cli-user",
        );
        console.log(`✅ Added IP ${ip} to whitelist`);

        // Check if this IP would be flagged as a threat
        const securityCheck = await threatIntelligenceService.checkIP(ip);
        if (securityCheck.metadata.isThreat) {
          console.log(
            `⚠️  Note: ${ip} was found in threat intelligence sources but is now whitelisted`,
          );
        }
        break;
      }

      case "add-cidr": {
        const cidr = args[1];
        const _reason = args[2];

        if (!cidr) {
          console.error("❌ CIDR block is required");
          console.log(
            "Usage: scripts/manage-whitelist.ts add-cidr [cidr] [reason]",
          );
          Deno.exit(1);
        }

        if (!IPValidationUtils.isValidCIDR(cidr)) {
          console.error(`❌ Invalid CIDR block: ${cidr}`);
          Deno.exit(1);
        }

        console.log(
          `❌ CIDR whitelist management not yet implemented in new threat intelligence service`,
        );
        console.log(`   This feature will be added in a future update`);
        Deno.exit(1);
        break;
      }

      case "remove-ip": {
        const ip = args[1];

        if (!ip) {
          console.error("❌ IP address is required");
          console.log("Usage: scripts/manage-whitelist.ts remove-ip [ip]");
          Deno.exit(1);
        }

        await threatIntelligenceService.removeFromWhitelist(ip);
        console.log(`✅ Removed IP ${ip} from whitelist`);
        break;
      }

      case "remove-cidr": {
        const cidr = args[1];

        if (!cidr) {
          console.error("❌ CIDR block is required");
          console.log("Usage: scripts/manage-whitelist.ts remove-cidr [cidr]");
          Deno.exit(1);
        }

        console.log(
          `❌ CIDR whitelist management not yet implemented in new threat intelligence service`,
        );
        console.log(`   This feature will be added in a future update`);
        Deno.exit(1);
        break;
      }

      case "list": {
        console.log("📋 Whitelisted Entries:");
        console.log("=======================");

        console.log(
          `❌ List functionality not yet implemented in new threat intelligence service`,
        );
        console.log(`   This feature will be added in a future update`);
        console.log(
          `   You can check individual IPs using the 'check' command`,
        );
        break;
      }

      case "check": {
        const ip = args[1];

        if (!ip) {
          console.error("❌ IP address is required");
          console.log("Usage: scripts/manage-whitelist.ts check [ip]");
          Deno.exit(1);
        }

        if (!IPValidationUtils.isValidIP(ip)) {
          console.error(`❌ Invalid IP address: ${ip}`);
          Deno.exit(1);
        }

        console.log(`🔍 Checking IP: ${ip}`);
        console.log("=================");

        const securityCheck = await threatIntelligenceService.checkIP(ip);

        console.log(
          `   Whitelisted: ${securityCheck.metadata.isWhitelisted ? "✅ Yes" : "❌ No"}`,
        );
        console.log(
          `   Threat status: ${securityCheck.metadata.isThreat ? "⚠️  Threat" : "✅ Clean"}`,
        );
        console.log(`   Risk score: ${securityCheck.riskScore}/100`);
        console.log(`   Action: ${securityCheck.action.toUpperCase()}`);
        console.log(`   Category: ${securityCheck.category}`);

        if (securityCheck.reasons.length > 0) {
          console.log(`   Reasons: ${securityCheck.reasons.join(", ")}`);
        }

        if (securityCheck.metadata.sources.length > 0) {
          console.log(
            `   Threat sources: ${securityCheck.metadata.sources.join(", ")}`,
          );
        }

        if (securityCheck.metadata.cacheHit !== undefined) {
          console.log(
            `   Cache hit: ${securityCheck.metadata.cacheHit ? "✅ Yes" : "❌ No"}`,
          );
        }
        break;
      }

      case "stats": {
        const stats = await threatIntelligenceService.getServiceStats();

        console.log("📊 Threat Intelligence Statistics:");
        console.log("==================================");
        console.log(
          `   Initialized: ${stats.isInitialized ? "✅ Yes" : "❌ No"}`,
        );
        console.log(
          `   Threat IPs: ${stats.dbStats.totalThreatIPs.toLocaleString()}`,
        );
        console.log(
          `   Threat CIDR blocks: ${stats.dbStats.totalThreatCIDRs.toLocaleString()}`,
        );
        console.log(
          `   Total threats: ${
            (stats.dbStats.totalThreatIPs + stats.dbStats.totalThreatCIDRs)
              .toLocaleString()
          }`,
        );
        console.log(
          `   Whitelisted IPs: ${stats.dbStats.totalWhitelistedIPs.toLocaleString()}`,
        );
        console.log(
          `   Whitelisted CIDR blocks: ${stats.dbStats.totalWhitelistedCIDRs.toLocaleString()}`,
        );
        console.log(
          `   Total whitelisted: ${
            (stats.dbStats.totalWhitelistedIPs +
              stats.dbStats.totalWhitelistedCIDRs).toLocaleString()
          }`,
        );
        console.log(
          `   Active sources: ${stats.dbStats.activeSources.toLocaleString()}`,
        );
        break;
      }

      default:
        console.error(`❌ Unknown action: ${action}`);
        showUsage();
        Deno.exit(1);
    }

    console.log("\n✅ Operation completed successfully!");
  } catch (error) {
    console.error(
      "❌ Error:",
      error instanceof Error ? error.message : String(error),
    );
    Deno.exit(1);
  }
}

// Run the script if executed directly
if (import.meta.main) {
  await main();
}
