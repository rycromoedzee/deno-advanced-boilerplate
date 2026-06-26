/**
 * @file services/threat-intelligence/parser-utils.ts
 * @description Parser Utils service module (threat intelligence)
 */
/**
 * Parser Utilities for Threat Intelligence
 *
 * Common fetch and parsing logic for threat source updates.
 */

import { IPValidationUtils } from "@utils/network/index.ts";

/**
 * Fetch URL with timeout
 * Handles timeout and error consistently across all parsers
 */
export async function fetchWithTimeout(url: string, timeoutMs = 60000): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timeout fetching ${url} (${timeoutMs}ms limit)`);
    }
    throw error;
  }
}

/**
 * Fetch JSON with timeout
 */
export async function fetchJSONWithTimeout<T>(url: string, timeoutMs = 60000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    return await response.json() as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timeout fetching ${url} (${timeoutMs}ms limit)`);
    }
    throw error;
  }
}

/**
 * Parse plain text list of IPs and CIDRs
 * Handles comment lines (# and ;)
 */
export function parsePlainTextList(text: string): { ips: Set<string>; cidrs: Set<string> } {
  const ips = new Set<string>();
  const cidrs = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

    if (trimmed.includes("/")) {
      if (IPValidationUtils.isValidCIDR(trimmed)) {
        cidrs.add(trimmed);
      }
    } else if (IPValidationUtils.isValidIP(trimmed)) {
      ips.add(trimmed);
    }
  }

  return { ips, cidrs };
}

/**
 * Parse Spamhaus DROP data in either current JSON export format or legacy text format.
 */
export function parseSpamhausDropList(text: string): { ips: Set<string>; cidrs: Set<string> } {
  const ips = new Set<string>();
  const cidrs = new Set<string>();

  try {
    const records = JSON.parse(text) as Array<{ cidr?: string }>;
    if (Array.isArray(records)) {
      for (const record of records) {
        const cidr = record.cidr?.trim();
        if (cidr && IPValidationUtils.isValidCIDR(cidr)) {
          cidrs.add(cidr);
        }
      }

      return { ips, cidrs };
    }
  } catch {
    // Fall through to legacy text parsing.
  }

  for (const line of text.split("\n")) {
    const withoutComment = line.split(";")[0].trim();
    if (!withoutComment || withoutComment.startsWith("#")) continue;

    if (withoutComment.includes("/") && IPValidationUtils.isValidCIDR(withoutComment)) {
      cidrs.add(withoutComment);
    } else if (IPValidationUtils.isValidIP(withoutComment)) {
      ips.add(withoutComment);
    }
  }

  return { ips, cidrs };
}

/**
 * Parse DShield block.txt tab-delimited rows into CIDRs.
 */
export function parseDShieldBlockList(text: string): { ips: Set<string>; cidrs: Set<string> } {
  const ips = new Set<string>();
  const cidrs = new Set<string>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;

    const [startIp, , prefix] = parts;
    const cidr = `${startIp}/${prefix}`;
    if (IPValidationUtils.isValidCIDR(cidr)) {
      cidrs.add(cidr);
    }
  }

  return { ips, cidrs };
}

/**
 * Parse DataPlane.org pipe-delimited feeds (sshpwauth, vncrfb, etc.).
 * Format per row: `ASN | ASname | IP address | lastseen | category`
 * (whitespace-padded around the `|`). The IP is the 3rd field, so the generic
 * plain-text parser — which expects a whole line to be an IP — extracts nothing.
 */
export function parseDataPlaneList(text: string): { ips: Set<string>; cidrs: Set<string> } {
  const ips = new Set<string>();
  const cidrs = new Set<string>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

    const fields = trimmed.split("|");
    if (fields.length < 3) continue;

    const candidate = fields[2].trim();
    if (candidate.includes("/")) {
      if (IPValidationUtils.isValidCIDR(candidate)) cidrs.add(candidate);
    } else if (IPValidationUtils.isValidIP(candidate)) {
      ips.add(candidate);
    }
  }

  return { ips, cidrs };
}

/**
 * Parse Ipsum.txt format
 * Format: IP [space] threat_level
 */ export function parseIpsumList(text: string, minLevel: number): { ips: Set<string>; cidrs: Set<string> } {
  const ips = new Set<string>();
  const cidrs = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const ip = parts[0];
      const level = parseInt(parts[1], 10);
      if (level >= minLevel && IPValidationUtils.isValidIP(ip)) {
        ips.add(ip);
      }
    }
  }

  return { ips, cidrs };
}

/**
 * Parse ThreatFox JSON format
 * Format: { "ioc_id": [{ "ioc_value": "IP:PORT" }, ...] }
 */
export function parseThreatFoxJSON(json: Record<string, Array<{ ioc_value: string }>>): { ips: Set<string>; cidrs: Set<string> } {
  const ips = new Set<string>();
  const cidrs = new Set<string>();
  for (const iocId in json) {
    const entries = json[iocId];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const ipPort = entry.ioc_value;
        // Split IP:port to get just the IP
        const colonIndex = ipPort.lastIndexOf(":");
        if (colonIndex > 0) {
          const ip = ipPort.substring(0, colonIndex);
          if (IPValidationUtils.isValidIP(ip)) {
            ips.add(ip);
          }
        }
      }
    }
  }

  return { ips, cidrs };
}

/**
 * Parse URLhaus text format
 * Format: List of URLs, extract hostnames that are IPs
 */
export function parseURLhausList(text: string): { ips: Set<string>; cidrs: Set<string> } {
  const ips = new Set<string>();
  const cidrs = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    try {
      const urlObj = new URL(trimmed);
      if (IPValidationUtils.isValidIP(urlObj.hostname)) {
        ips.add(urlObj.hostname);
      }
    } catch {
      continue;
    }
  }

  return { ips, cidrs };
}

/**
 * Parse AbuseIPDB blocklist format (borestad/blocklist-abuseipdb)
 * Format: IP_ADDRESS       # COUNTRY  AS_NUMBER   AS_NAME
 * Example: 1.0.68.149       # JP  AS18144   Enecom,Inc.
 */
export function parseAbuseIPDBBlocklist(text: string): { ips: Set<string>; cidrs: Set<string> } {
  const ips = new Set<string>();
  const cidrs = new Set<string>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Extract the IP address (everything before the first #)
    const hashIndex = trimmed.indexOf("#");
    if (hashIndex === -1) continue;

    const ipPart = trimmed.substring(0, hashIndex).trim();

    // Validate and add IP or CIDR
    if (ipPart.includes("/")) {
      if (IPValidationUtils.isValidCIDR(ipPart)) {
        cidrs.add(ipPart);
      }
    } else if (IPValidationUtils.isValidIP(ipPart)) {
      ips.add(ipPart);
    }
  }

  return { ips, cidrs };
}

/**
 * Parser configuration
 */
export interface ParserConfig {
  name: string;
  url: string;
  riskScore: number;
  category: string;
  fetch: () => Promise<{ ips: Set<string>; cidrs: Set<string> }>;
}
