/**
 * @file utils/network/request-helpers.ts
 * @description HTTP request helper utilities
 */
import { envConfig } from "@config/env.ts";

/**
 * Derivable request-derived info (user-agent parsing and custom-domain
 * classification). The unrelated former `RequestHelpers` static methods that
 * had zero callers (getRequestSize, isMobileRequest, getPreferredLanguage,
 * isAjaxRequest) were pruned; the two that earned their keep are exported as
 * plain functions — they share no state, so the class wrapper bought nothing.
 */

export interface UserAgentInfo {
  device: string;
  browser: string;
  os: string;
}

export function getUserAgentInfo(userAgent: string): UserAgentInfo {
  const ua = userAgent.toLowerCase();

  const deviceInfo: UserAgentInfo = {
    device: "unknown",
    browser: "unknown",
    os: "unknown",
  };

  // Detect Device Type
  if (ua.includes("mobile")) {
    deviceInfo.device = "mobile";
  } else if (ua.includes("tablet")) {
    deviceInfo.device = "tablet";
  } else {
    deviceInfo.device = "desktop";
  }

  // Detect Browser
  if (ua.includes("firefox")) {
    deviceInfo.browser = "firefox";
  } else if (ua.includes("chrome")) {
    deviceInfo.browser = "chrome";
  } else if (ua.includes("safari")) {
    deviceInfo.browser = "safari";
  }

  // Detect OS
  if (ua.includes("windows")) {
    deviceInfo.os = "windows";
  } else if (ua.includes("mac")) {
    deviceInfo.os = "macos";
  } else if (ua.includes("linux")) {
    deviceInfo.os = "linux";
  } else if (ua.includes("android")) {
    deviceInfo.os = "android";
  } else if (ua.includes("ios")) {
    deviceInfo.os = "ios";
  }

  return deviceInfo;
}

export function getCustomDomain(
  honoContextUrl: string,
): { isCustomDomain: boolean; isSubdomain: boolean; domain: string } {
  const url = new URL(honoContextUrl);
  const hostname = url.hostname;

  if (envConfig.isDevelopment) {
    return {
      isCustomDomain: false,
      isSubdomain: false,
      domain: hostname,
    };
  }

  if (hostname.includes("bunny.run")) {
    return {
      isCustomDomain: false,
      isSubdomain: false,
      domain: hostname,
    };
  }

  if (hostname.includes(envConfig.baseDomain)) {
    return {
      isCustomDomain: false,
      isSubdomain: false,
      domain: hostname,
    };
  }

  // Remove the base domain from the hostname
  if (!hostname.endsWith(envConfig.baseDomain) && !hostname.includes("bunny.run")) {
    return {
      isCustomDomain: true,
      isSubdomain: false,
      domain: hostname,
    };
  }

  const subdomain = hostname.replace(`.${envConfig.baseDomain}`, "");

  // If subdomain equals the base domain, there's no subdomain
  if (subdomain === envConfig.baseDomain.split(".")[0]) {
    return {
      isCustomDomain: true,
      isSubdomain: false,
      domain: hostname,
    };
  }

  return {
    isCustomDomain: false,
    isSubdomain: true,
    domain: subdomain,
  };
}
