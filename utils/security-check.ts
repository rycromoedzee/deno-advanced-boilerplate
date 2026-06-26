/**
 * @file utils/security-check.ts
 * @description Security check utilities
 */
interface ValidationResponse {
  isSuccess: boolean;
  reason: string | null;
}

interface ValidatedString {
  valid: boolean;
  text: string | null;
}

import { ITokensDeviceTypeOptions } from "@services/token/config.ts";
import { envConfig } from "@config/env.ts";

/**
 * Validates domain restrictions with wildcard support.
 * Supports standard domains and wildcard subdomains (*.example.com).
 * Enforces strict domain syntax, length, label rules, and security best practices.
 */
export function useValidateDomainBeforeInsert(
  domains: string[],
  isAllowWildcard: boolean = true,
): ValidationResponse {
  if (!domains || domains.length === 0) {
    return {
      isSuccess: true,
      reason: null,
    };
  }

  const localhostRegex = /^(localhost|127\.0\.0\.1|::1)(:\d+)?$/i;
  const domainRegex = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  const tldRegex = /\.[a-zA-Z]{2,}$/;

  const seen = new Set<string>();

  for (const rawDomain of domains) {
    const domain = rawDomain.trim().toLowerCase();

    // 1. Non-empty
    if (!domain) {
      return {
        isSuccess: false,
        reason: "No domain provided",
      };
    }

    // 2. Detect duplicates early (after normalization)
    if (seen.has(domain)) {
      return {
        isSuccess: false,
        reason: "Duplicate(s) provided",
      };
    }
    seen.add(domain);

    // 3. Allow localhost-like addresses
    if (localhostRegex.test(domain)) continue;

    // 4. Length: Max 253 characters
    if (domain.length > 253) {
      return {
        isSuccess: false,
        reason: "Domain too long",
      };
    }

    // 5. Invalid dot patterns
    if (
      domain.startsWith(".") ||
      domain.endsWith(".") ||
      domain.includes("..")
    ) {
      return {
        isSuccess: false,
        reason: "Invalid domain format (leading, trailing, or double dot)",
      };
    }

    // 6. Basic regex format
    if (!domainRegex.test(domain)) {
      return {
        isSuccess: false,
        reason: "Invalid domain format",
      };
    }

    if (!isAllowWildcard && domain.includes("*")) {
      return {
        isSuccess: false,
        reason: "Wildcard not allowed",
      };
    }

    // 7. Wildcard handling
    const isWildcard = domain.startsWith("*.");
    if (isWildcard) {
      const baseDomain = domain.substring(2);
      if (
        !baseDomain || !baseDomain.includes(".") || !tldRegex.test(baseDomain)
      ) {
        return {
          isSuccess: false,
          reason: "Invalid wildcard domain",
        };
      }
    } else {
      // Non-wildcard must have valid TLD
      if (!tldRegex.test(domain)) {
        return {
          isSuccess: false,
          reason: "Domain must have a valid TLD",
        };
      }
    }

    // 8. Advanced wildcard validation
    const asterisks = domain.match(/\*/g);
    if (asterisks && asterisks.length > 1) {
      return {
        isSuccess: false,
        reason: "Only one wildcard (*) allowed",
      };
    }
    if (domain.includes("*") && (!domain.startsWith("*.") || domain === "*")) {
      return {
        isSuccess: false,
        reason: "Invalid wildcard",
      };
    }

    // 9. Validate individual label lengths (per RFC 1035, max 63 chars)
    const labels = domain.replace(/^\*\./, "").split(".");
    for (const label of labels) {
      if (label.length === 0) {
        return {
          isSuccess: false,
          reason: "Invalid domain",
        };
      }
      if (label.length > 63) {
        return {
          isSuccess: false,
          reason: "Invalid domain",
        };
      }
    }
  }

  return {
    isSuccess: true,
    reason: null,
  };
}

export function useValidateDomainAgainstAllowList(
  domain: string,
  allowedDomains: string[],
) {
  const normalizedClientDomain = domain.toLowerCase().trim();

  for (const restriction of allowedDomains) {
    const normalizedRestriction = restriction.toLowerCase().trim();

    // Exact match
    if (normalizedRestriction === normalizedClientDomain) {
      return true;
    }

    // Wildcard matching
    if (normalizedRestriction.startsWith("*.")) {
      const wildcardDomain = normalizedRestriction.substring(2);
      if (
        normalizedClientDomain.endsWith("." + wildcardDomain) ||
        normalizedClientDomain === wildcardDomain
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate IP restrictions using CIDR notation support.
 * Supports IPv4, IPv6, localhost with optional CIDR blocks.
 * Enforces strict format, valid CIDR ranges, and no duplicates.
 */
export function useValidateIpBeforeInsert(ips: string[]): ValidationResponse {
  if (envConfig.isDevelopment) {
    return {
      isSuccess: true,
      reason: null,
    };
  }

  if (!ips || ips.length === 0) {
    return {
      isSuccess: true,
      reason: null,
    };
  }

  // IPv4: x.x.x.x with optional /prefix (0-32)
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:[0-9]|[12][0-9]|3[0-2]))?$/;

  // IPv6: Full regex supporting compressed form with optional /prefix (0-128)
  const ipv6Regex =
    /^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::)(?:\/(?:[0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$/;

  const seen = new Set<string>();

  for (const rawIp of ips) {
    const ip = rawIp.trim();

    // 1. Non-empty
    if (!ip) {
      throw new Error("Empty IP restriction found.");
    }

    // 2. Normalize and check duplicates (case-insensitive)
    const normalized = ip.toLowerCase();
    if (seen.has(normalized)) {
      throw new Error("Duplicate IP restriction found.");
    }
    seen.add(normalized);

    // 3. Length sanity check (max FQDN-style IP strings are not this long)
    if (ip.length > 255) {
      throw new Error(`IP restriction too long: ${rawIp}`);
    }

    // 4. Check for CIDR part
    const parts = ip.split("/");
    const hasCidr = parts.length > 1;
    const cidrStr = hasCidr ? parts[1] : null;
    const base = parts[0];

    // 5. Validate CIDR if present
    if (hasCidr) {
      const cidr = parseInt(cidrStr!, 10);
      if (isNaN(cidr) || cidr < 0) {
        throw new Error(
          `Invalid CIDR value: ${cidrStr}. Must be a number ≥ 0.`,
        );
      }

      // IPv4 CIDR: 0–32
      if (ipv4Regex.test(ip)) {
        if (cidr > 32) {
          throw new Error(`IPv4 CIDR must be ≤ 32. Got: ${cidr} in ${rawIp}`);
        }
      } // IPv6 CIDR: 0–128
      else if (ipv6Regex.test(ip)) {
        if (cidr > 128) {
          throw new Error(
            `IPv6 CIDR must be ≤ 128. Got: ${cidr} in ${rawIp}`,
          );
        }
      } // localhost with CIDR?
      else if (/^(127\.0\.0\.1|::1|localhost)$/i.test(base)) {
        // Allow only specific CIDR: /32 for IPv4, /128 for IPv6
        const expected = base.includes(":") || base === "::1" ? 128 : 32;
        if (cidr !== expected) {
          throw new Error(
            `Localhost-like IP '${base}' allows only /${expected} CIDR. Found: /${cidr}`,
          );
        }
      } // Invalid CIDR on unrecognized format
      else {
        throw new Error(
          `Invalid IP/CIDR format: ${rawIp}. Not a valid IPv4, IPv6, or localhost.`,
        );
      }
    }

    // 6. Full regex validation (with or without CIDR)
    if (
      !ipv4Regex.test(ip) &&
      !ipv6Regex.test(ip) &&
      !/^(127\.0\.0\.1|::1|localhost)(?:\/(?:[0-9]|[12][0-9]|3[0-2]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$/i
        .test(ip)
    ) {
      throw new Error(
        `Invalid IP restriction: ${rawIp}. Use IPv4, IPv6, or localhost with valid CIDR notation.`,
      );
    }

    // 7. Extra: Disallow malformed base IPs (empty or invalid)
    if (!base || base === "::" || base === ".") {
      throw new Error(`Invalid IP address base: ${base}`);
    }
  }
  return {
    isSuccess: true,
    reason: null,
  };
}

export function useValidateIpAgainstAllowList(
  ip: string,
  allowedIps: string[],
) {
  for (const restriction of allowedIps) {
    if (restriction === ip) {
      return true;
    }

    // Handle CIDR notation
    if (restriction.includes("/")) {
      if (ipMatchesCIDR(ip, restriction)) {
        return true;
      }
    }
  }

  return false;
}

function ipMatchesCIDR(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);

  // Simple IPv4 CIDR matching
  if (ip.includes(".") && network.includes(".")) {
    const ipParts = ip.split(".").map((p) => parseInt(p, 10));
    const networkParts = network.split(".").map((p) => parseInt(p, 10));

    if (ipParts.length !== 4 || networkParts.length !== 4) {
      return false;
    }

    // Convert to 32-bit integers
    const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) |
      ipParts[3];
    const networkInt = (networkParts[0] << 24) | (networkParts[1] << 16) |
      (networkParts[2] << 8) | networkParts[3];

    // Create mask
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix));

    return (ipInt & mask) === (networkInt & mask);
  }

  // For IPv6, we need more complex logic - for now, only exact match
  return false;
}

export function useValidateAndSanitizeString(
  input: unknown,
  maxLength: number = 100,
  isReturnUknownIfUndefined: boolean = false,
) {
  if (typeof input !== "string") {
    if (isReturnUknownIfUndefined) {
      return "unknown";
    }
    throw new Error(`must be a string`);
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    throw new Error(`cannot be empty`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`exceeds maximum length of ${maxLength} characters`);
  }

  // Check for potentially malicious patterns
  const maliciousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // Script tags
    /javascript:/gi, // JavaScript protocol
    /on\w+\s*=/gi, // Event handlers
    /data:text\/html/gi, // Data URLs
    /vbscript:/gi, // VBScript protocol
  ];

  for (const pattern of maliciousPatterns) {
    if (pattern.test(trimmed)) {
      throw new Error(`contains potentially malicious content`);
    }
  }

  return trimmed;
}

/**
 * Validates array input with length limits
 * @param input - Array to validate
 * @param fieldName - Name of the field for error messages
 * @param maxLength - Maximum allowed array length
 * @returns Validated array
 * @throws Error if validation fails
 */
export function useValidateArrayAndLength<T>(
  input: unknown,
  maxLength: number = 10,
): T[] {
  if (!Array.isArray(input)) {
    throw new Error(`must be an array`);
  }

  if (input.length > maxLength) {
    throw new Error(
      `exceeds maximum length of ${maxLength} items`,
    );
  }

  return input as T[];
}

//
export function useValidateDeviceInfo(
  deviceInfo: ITokensDeviceTypeOptions,
  isReturnUknownIfUndefined: boolean = true,
) {
  if (!deviceInfo || typeof deviceInfo !== "object") {
    throw new Error("Device information is required and must be an object");
  }

  const userAgent = useValidateAndSanitizeString(
    deviceInfo.userAgent,
    256,
    isReturnUknownIfUndefined,
  );

  const accept = useValidateAndSanitizeString(
    deviceInfo.accept,
    75,
    isReturnUknownIfUndefined,
  );

  const lang = useValidateAndSanitizeString(
    deviceInfo.lang,
    50,
    isReturnUknownIfUndefined,
  );

  return { userAgent, accept, lang };
}
