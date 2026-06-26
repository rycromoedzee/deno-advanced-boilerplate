/**
 * @file utils/network/ip-lookup.ts
 * @description Client IP extraction/lookup helpers
 */
import { IP_CONSTANTS } from "../shared/constants.ts";
import { RequestContext } from "../shared/types.ts";
import { HonoContext } from "@deps";
import { IPValidationUtils } from "./ip-validation.ts";

/**
 * Request-context IP utilities.
 *
 * Pure IP/CIDR validation (`isValidIP`, `isPrivateIP`, CIDR math) lives in
 * {@link IPValidationUtils}, the single source of truth. This module is the
 * thin Hono-aware layer that extracts IP/context from a request and anonymizes
 * IPs for logging — it delegates all validation decisions to IPValidationUtils
 * rather than reimplementing them.
 */
export class IPLookupUtils {
  /**
   * Extract IP address from request object
   */
  static extractIPFromRequest(c: HonoContext): string | null {
    // Check various headers for the real IP
    const possibleHeaders = [
      "x-forwarded-for",
      "x-real-ip",
      "x-client-ip",
      "cf-connecting-ip", // Cloudflare
      "x-forwarded",
      "forwarded-for",
      "forwarded",
    ];

    for (const header of possibleHeaders) {
      const value = c.req.header(header);
      if (value) {
        // x-forwarded-for can contain multiple IPs, take the first one
        const ip = value.split(",")[0].trim();
        if (
          IPValidationUtils.isValidIP(ip) &&
          !IPValidationUtils.isPrivateIP(ip)
        ) {
          return ip;
        }
      }
    }

    const connInfo = c.env?.connInfo || c.get("connInfo");
    if (connInfo?.remoteAddr) {
      return connInfo.remoteAddr.hostname;
    }

    // Check if running on Cloudflare Workers
    if (c.env?.CF_CONNECTING_IP) {
      return c.env.CF_CONNECTING_IP;
    }

    // For other environments, there's no direct socket access
    // Return null rather than a misleading value
    return null;
  }

  /**
   * Get comprehensive request context including IP info
   */
  static getRequestContext(req: HonoContext): RequestContext {
    const ip = this.extractIPFromRequest(req);

    return {
      ip: ip || "unknown",
      userAgent: req.req.header("user-agent") || "Unknown",
      timestamp: new Date(),
      headers: req.req.header() || {},
    };
  }

  /**
   * Anonymize IP for logging/privacy
   */
  static anonymizeIP(ip: string): string {
    if (IP_CONSTANTS.IPV4_REGEX.test(ip)) {
      // For IPv4, zero out the last octet
      return ip.replace(/\.\d+$/, ".0");
    } else if (IP_CONSTANTS.IPV6_REGEX.test(ip)) {
      // For IPv6, zero out the last 64 bits
      const parts = ip.split(":");
      return parts.slice(0, 4).join(":") + "::";
    }

    return "anonymized";
  }
}
