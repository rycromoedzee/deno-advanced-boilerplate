/**
 * @file utils/network/ip-validation.ts
 * @description IP address validation helpers
 */
/**
 * IP Address Validation and Analysis Utilities
 *
 * Consolidated IP validation functions used across security services.
 * This module provides consistent IP validation, CIDR operations,
 * and network analysis utilities.
 */

import { IP_CONSTANTS } from "../shared/index.ts";

export class IPValidationUtils {
  /**
   * Validate an IP address format (IPv4 or IPv6).
   */
  static isValidIP(ip: string): boolean {
    return IP_CONSTANTS.IPV4_REGEX.test(ip) || IP_CONSTANTS.IPV6_REGEX.test(ip);
  }

  /**
   * Validate a CIDR block (IPv4 `/0`–`/32` or IPv6 `/0`–`/128`).
   */
  static isValidCIDR(cidr: string): boolean {
    const parts = cidr.split("/");
    if (parts.length !== 2) return false;
    const [ip, prefixStr] = parts;
    if (!/^\d+$/.test(prefixStr)) return false;
    const prefix = parseInt(prefixStr, 10);

    if (IP_CONSTANTS.IPV4_REGEX.test(ip)) return prefix >= 0 && prefix <= 32;
    if (IP_CONSTANTS.IPV6_REGEX.test(ip)) return prefix >= 0 && prefix <= 128;
    return false;
  }

  /**
   * Check if IP is in a private / reserved / non-routable range.
   *
   * Single source of truth — unifies the former octet-parsing IPv4 logic
   * (which covered RFC 1918 + loopback + link-local + multicast/reserved
   * via `a >= 224`) with IPv6 private/reserved detection (which the IPv4-only
   * parse missed entirely). IPv4 is decided by octet math; anything else is
   * matched against `IP_CONSTANTS.PRIVATE_IP_RANGES` (IPv6 loopback/link-local/
   * ULA/multicast/unspecified).
   */
  static isPrivateIP(ip: string): boolean {
    // IPv4: precise octet math. Catches RFC 1918 + loopback + link-local +
    // multicast (224.0.0.0/4) + reserved (240.0.0.0/4).
    const parts = ip.split(".").map(Number);
    if (
      parts.length === 4 &&
      parts.every((part) => !isNaN(part) && part >= 0 && part <= 255)
    ) {
      const [a, b] = parts;
      return (
        a === 10 || // 10.0.0.0/8
        (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
        (a === 192 && b === 168) || // 192.168.0.0/16
        a === 127 || // 127.0.0.0/8 (loopback)
        (a === 169 && b === 254) || // 169.254.0.0/16 (link-local)
        a >= 224 // 224.0.0.0/4 (multicast) + 240.0.0.0/4 (reserved)
      );
    }

    // IPv6 (and anything non-IPv4): match against the curated regex ranges.
    return IP_CONSTANTS.PRIVATE_IP_RANGES.some((range) => range.test(ip));
  }

  /**
   * Convert IP address to number for CIDR calculations
   */
  static ipToNumber(ip: string): number {
    const parts = ip.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => isNaN(part) || part < 0 || part > 255)
    ) {
      throw new Error("Invalid IP address");
    }

    return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  }

  /**
   * Check if IP number is within CIDR range
   */
  static isIPInCIDR(ipNum: number, cidr: string): boolean {
    try {
      const [network, prefixStr] = cidr.split("/");
      const prefix = parseInt(prefixStr, 10);

      if (prefix < 0 || prefix > 32) {
        return false;
      }

      const networkNum = this.ipToNumber(network);
      const mask = ~((1 << (32 - prefix)) - 1);

      return (ipNum & mask) === (networkNum & mask);
    } catch (_error) {
      return false;
    }
  }

  /**
   * Check if IP matches any CIDR block in a list. Family-aware: an IPv4 IP is
   * matched against IPv4 CIDRs (32-bit math); an IPv6 IP against IPv6 CIDRs
   * (128-bit byte compare). Cross-family never matches.
   */
  static matchesAnyCIDR(ip: string, cidrs: string[]): boolean {
    const isV6 = IP_CONSTANTS.IPV6_REGEX.test(ip);
    for (const cidr of cidrs) {
      if (isV6) {
        if (this.isIPv6InCIDR(ip, cidr)) return true;
      } else {
        try {
          if (this.isIPInCIDR(this.ipToNumber(ip), cidr)) return true;
        } catch (_error) {
          // invalid IPv4 IP or CIDR — no match
        }
      }
    }
    return false;
  }

  /**
   * Parse a standard IPv6 address (8 groups, or `::` shorthand) into 16 bytes.
   * IPv4-mapped tails (`::ffff:1.2.3.4`) are rejected — use plain IPv4 instead.
   * @throws Error on any malformed input.
   */
  private static ipv6ToBytes(ip: string): Uint8Array {
    const bytes = new Uint8Array(16);
    let groups: string[];
    if (ip.includes("::")) {
      const idx = ip.indexOf("::");
      if (ip.indexOf("::", idx + 1) !== -1) throw new Error("Invalid IPv6 (multiple ::)");
      const headStr = ip.slice(0, idx);
      const tailStr = ip.slice(idx + 2);
      const head = headStr ? headStr.split(":") : [];
      const tail = tailStr ? tailStr.split(":") : [];
      if (head.length + tail.length >= 8) throw new Error("Invalid IPv6 (too many groups for ::)");
      const zeros = Array<string>(8 - head.length - tail.length).fill("0");
      groups = [...head, ...zeros, ...tail];
    } else {
      groups = ip.split(":");
    }
    if (groups.length !== 8) throw new Error("Invalid IPv6 (expected 8 groups)");
    for (let i = 0; i < 8; i++) {
      const g = groups[i];
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new Error(`Invalid IPv6 group: "${g}"`);
      const val = parseInt(g, 16);
      bytes[i * 2] = (val >> 8) & 0xff;
      bytes[i * 2 + 1] = val & 0xff;
    }
    return bytes;
  }

  /**
   * Check whether an IPv6 address is within an IPv6 CIDR block (`/0`–`/128`).
   * Compares the first `prefix` bits of the 16-byte representations.
   */
  private static isIPv6InCIDR(ip: string, cidr: string): boolean {
    try {
      const [network, prefixStr] = cidr.split("/");
      const prefix = parseInt(prefixStr, 10);
      if (prefix < 0 || prefix > 128) return false;
      const ipBytes = this.ipv6ToBytes(ip);
      const netBytes = this.ipv6ToBytes(network);
      const fullBytes = Math.floor(prefix / 8);
      const remBits = prefix % 8;
      for (let i = 0; i < fullBytes; i++) {
        if (ipBytes[i] !== netBytes[i]) return false;
      }
      if (remBits > 0) {
        const mask = (0xff << (8 - remBits)) & 0xff;
        if ((ipBytes[fullBytes] & mask) !== (netBytes[fullBytes] & mask)) return false;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Expand CIDR block to individual IPs (for small blocks only)
   * Returns empty array for large blocks to prevent memory issues
   */
  static expandSmallCIDR(cidr: string, maxIPs: number = 256): string[] {
    const [ip, prefixStr] = cidr.split("/");
    const prefix = parseInt(prefixStr, 10);

    // Only expand blocks with reasonable size
    const hostBits = 32 - prefix;
    const numHosts = Math.pow(2, hostBits);

    if (numHosts > maxIPs) {
      return []; // Too large to expand
    }

    const ips: string[] = [];
    const baseIP = this.ipToNumber(ip);
    const networkMask = ~((1 << hostBits) - 1);
    const networkBase = baseIP & networkMask;

    for (let i = 0; i < numHosts; i++) {
      const hostIP = networkBase | i;
      const expandedIP = [
        (hostIP >>> 24) & 0xFF,
        (hostIP >>> 16) & 0xFF,
        (hostIP >>> 8) & 0xFF,
        hostIP & 0xFF,
      ].join(".");

      // Skip network and broadcast addresses
      if (i === 0 || i === numHosts - 1) {
        continue;
      }

      ips.push(expandedIP);
    }

    return ips;
  }
}
