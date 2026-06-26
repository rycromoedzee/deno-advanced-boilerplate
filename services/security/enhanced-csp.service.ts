/**
 * @file services/security/enhanced-csp.service.ts
 * @description Enhanced Csp service (security)
 */
import { type HonoContext } from "@deps";
import { useLogSecurityEvent } from "@services/logger/logger.ts";
import { loggerAppSections, LoggerLevels } from "@logger/index.ts";

export type CSPMode = "strict" | "moderate" | "permissive";

export interface CSPOptions {
  mode: CSPMode;
  enableNonce?: boolean;
  trustedDomains?: string[];
  reportingEndpoint?: string;
  enforceHttps?: boolean;
}

export interface CSPContext {
  path: string;
  method: string;
  isApi: boolean;
  isAdmin: boolean;
  isInternal?: boolean;
}

export interface CSPPolicy {
  defaultSrc?: string[];
  scriptSrc?: string[];
  styleSrc?: string[];
  imgSrc?: string[];
  connectSrc?: string[];
  fontSrc?: string[];
  objectSrc?: string[];
  mediaSrc?: string[];
  frameSrc?: string[];
  childSrc?: string[];
  formAction?: string[];
  baseUri?: string[];
  manifestSrc?: string[];
  workerSrc?: string[];
  reportUri?: string;
  upgradeInsecureRequests?: string[];
  blockAllMixedContent?: string[];
}

export interface CSPViolationReport {
  documentUri: string;
  referrer: string;
  violatedDirective: string;
  effectiveDirective: string;
  originalPolicy: string;
  disposition: string;
  blockedUri: string;
  lineNumber?: number;
  columnNumber?: number;
  sourceFile?: string;
  statusCode: number;
  scriptSample?: string;
}

/**
 * Enhanced CSP service built on top of Hono's secureHeaders
 * Focuses on the most valuable features: smart policies, nonces, and violation monitoring
 */
export class EnhancedCSPService {
  private static nonceCache = new Map<
    string,
    { nonce: string; expires: number }
  >();
  private static readonly NONCE_EXPIRY = 300000; // 5 minutes
  private static readonly NONCE_LENGTH = 32;

  /**
   * Generate secure nonce for inline scripts/styles
   */
  static generateNonce(sessionId?: string): string {
    const key = sessionId || "global";
    const cached = this.nonceCache.get(key);

    // Return cached nonce if still valid
    if (cached && cached.expires > Date.now()) {
      return cached.nonce;
    }

    // Generate new nonce
    const array = new Uint8Array(this.NONCE_LENGTH);
    crypto.getRandomValues(array);
    const nonce = btoa(String.fromCharCode(...array))
      .replace(/[+/]/g, (char) => char === "+" ? "-" : "_")
      .replace(/=/g, "");

    // Cache the nonce
    this.nonceCache.set(key, {
      nonce,
      expires: Date.now() + this.NONCE_EXPIRY,
    });

    // Clean up expired nonces
    this.cleanupExpiredNonces();

    return nonce;
  }

  /**
   * Get CSP policy for Hono's secureHeaders based on context and options
   */
  static getCSPPolicy(options: CSPOptions, context?: CSPContext): CSPPolicy {
    const nonce = options.enableNonce ? this.generateNonce() : null;

    // Base policies for different security levels
    const policies = {
      strict: {
        defaultSrc: ["'self'"],
        scriptSrc: nonce ? ["'self'", `'nonce-${nonce}'`] : ["'self'"],
        styleSrc: nonce ? ["'self'", `'nonce-${nonce}'`] : ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        childSrc: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        upgradeInsecureRequests: [],
        blockAllMixedContent: [],
      },
      moderate: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'self'"],
        childSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        upgradeInsecureRequests: [],
      },
      permissive: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        connectSrc: ["'self'", "https:", "wss:", "ws:"],
        fontSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'self'"],
        mediaSrc: ["'self'", "https:"],
        frameSrc: ["'self'", "https:"],
        childSrc: ["'self'", "https:"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
      },
    };

    let policy: CSPPolicy = { ...policies[options.mode] };

    // Context-specific modifications
    if (context) {
      // Internal routes (like cache visualizer) need script access even under /api/
      if (context.isInternal) {
        // For internal routes, allow scripts from self but keep other restrictions
        policy = {
          ...policy,
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https:", "wss:", "ws:"],
          frameSrc: ["'self'"],
          objectSrc: ["'self'"],
        };
      } // API endpoints get very restrictive policies (but internal routes override this)
      else if (context.isApi) {
        policy = {
          defaultSrc: ["'none'"],
          scriptSrc: ["'none'"],
          styleSrc: ["'none'"],
          imgSrc: ["'none'"],
          connectSrc: ["'self'"], // Allow API calls
          fontSrc: ["'none'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],
          frameSrc: ["'none'"],
          childSrc: ["'none'"],
          formAction: ["'none'"],
          baseUri: ["'self'"],
          manifestSrc: ["'none'"],
          workerSrc: ["'none'"],
        };
      }

      // Admin areas get stricter policies
      if (context.isAdmin && options.mode !== "permissive") {
        policy = {
          ...policy,
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for admin UI
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
        };
      }
    }

    // Add trusted domains
    if (options.trustedDomains && options.trustedDomains.length > 0) {
      const updatedPolicy: CSPPolicy = { ...policy };
      const directivesToUpdate: (keyof CSPPolicy)[] = [
        "scriptSrc",
        "styleSrc",
        "imgSrc",
        "connectSrc",
        "fontSrc",
        "mediaSrc",
      ];
      directivesToUpdate.forEach((directive) => {
        const currentValue = updatedPolicy[directive];
        if (currentValue && Array.isArray(currentValue)) {
          options.trustedDomains!.forEach((domain) => {
            if (!currentValue.includes(domain)) {
              currentValue.push(domain);
            }
          });
        }
      });
      policy = updatedPolicy;
    }

    // Add reporting
    if (options.reportingEndpoint) {
      policy = { ...policy, reportUri: options.reportingEndpoint };
    }

    // Enforce HTTPS
    if (options.enforceHttps) {
      policy = {
        ...policy,
        upgradeInsecureRequests: [],
        blockAllMixedContent: [],
      };
    }

    return policy;
  }

  /**
   * Create middleware that enhances Hono's secureHeaders with smart CSP
   */
  static createSmartCSPMiddleware(options: CSPOptions) {
    return async (c: HonoContext, next: () => Promise<void>) => {
      const context: CSPContext = {
        path: c.req.path,
        method: c.req.method,
        isApi: c.req.path.startsWith("/api/"),
        isAdmin: c.req.path.startsWith("/admin/"),
        isInternal: c.req.path.startsWith("/api/internal/"),
      };

      // Get the smart CSP policy
      const cspPolicy = this.getCSPPolicy(options, context);

      // Store the policy in context for use by secureHeaders
      c.set("smartCSPPolicy", cspPolicy);

      // Store nonce in context if enabled
      if (options.enableNonce) {
        const nonce = this.extractNonceFromPolicy(cspPolicy);
        if (nonce) {
          c.set("cspNonce", nonce);
        }
      }

      await next();
    };
  }

  /**
   * Process CSP violation reports with attack detection
   */
  static async processViolationReport(
    report: CSPViolationReport,
    context?: { ip?: string; userAgent?: string; userId?: string },
  ): Promise<void> {
    const severity = this.assessViolationSeverity(report);

    await useLogSecurityEvent(
      LoggerLevels.warn,
      `CSP violation: ${report.violatedDirective} blocked ${report.blockedUri} on ${report.documentUri}`,
      severity,
      loggerAppSections.CSP,
      "CSP.Violation_Detected",
      {
        violatedDirective: report.violatedDirective,
        blockedUri: report.blockedUri,
        documentUri: report.documentUri,
        sourceFile: report.sourceFile,
        lineNumber: report.lineNumber,
        columnNumber: report.columnNumber,
        scriptSample: report.scriptSample?.substring(0, 200),
        userAgent: context?.userAgent,
        ip: context?.ip,
        userId: context?.userId,
        timestamp: new Date().toISOString(),
      },
    );

    // Check for potential attack patterns
    if (this.isLikelyAttack(report)) {
      await useLogSecurityEvent(
        LoggerLevels.error,
        `CSP attack detected: ${this.getAttackIndicators(report).join(", ")} in ${report.violatedDirective} from ${
          context?.ip || "unknown IP"
        }`,
        "high",
        loggerAppSections.CSP,
        "CSP.Attack_Detected",
        {
          violatedDirective: report.violatedDirective,
          blockedUri: report.blockedUri,
          documentUri: report.documentUri,
          attackIndicators: this.getAttackIndicators(report),
          userAgent: context?.userAgent,
          ip: context?.ip,
          userId: context?.userId,
          timestamp: new Date().toISOString(),
        },
      );
    }
  }

  /**
   * Get predefined CSP options for common use cases
   */
  static getPresetOptions(type: CSPMode): CSPOptions {
    const baseOptions: CSPOptions = {
      mode: type,
      enforceHttps: true,
      enableNonce: false,
    };

    switch (type) {
      case "strict":
        return {
          ...baseOptions,
          enableNonce: true,
          reportingEndpoint: "/api/security/csp/report",
        };

      case "moderate":
        return {
          ...baseOptions,
          trustedDomains: [
            "https://cdnjs.cloudflare.com",
            "https://fonts.googleapis.com",
          ],
        };

      case "permissive":
        return baseOptions;

      default:
        return baseOptions;
    }
  }

  // Helper methods
  private static cleanupExpiredNonces(): void {
    const now = Date.now();
    for (const [key, value] of this.nonceCache.entries()) {
      if (value.expires <= now) {
        this.nonceCache.delete(key);
      }
    }
  }

  private static extractNonceFromPolicy(policy: CSPPolicy): string | null {
    const scriptSrc = policy.scriptSrc || [];
    for (const src of scriptSrc) {
      if (src.startsWith("'nonce-")) {
        return src.slice(7, -1); // Remove 'nonce-' and trailing '
      }
    }
    return null;
  }

  private static assessViolationSeverity(
    report: CSPViolationReport,
  ): "low" | "medium" | "high" | "critical" {
    if (report.violatedDirective.startsWith("script-src")) {
      return "high";
    }
    if (
      report.violatedDirective.startsWith("style-src") ||
      report.violatedDirective.startsWith("connect-src")
    ) {
      return "medium";
    }
    return "low";
  }

  private static isLikelyAttack(report: CSPViolationReport): boolean {
    const suspiciousPatterns = [
      /javascript:/i,
      /data:text\/html/i,
      /eval\(/i,
      /alert\(/i,
      /document\.cookie/i,
      /window\.location/i,
      /<script/i,
      /onerror=/i,
      /onload=/i,
    ];

    const blockedUri = report.blockedUri.toLowerCase();
    const scriptSample = (report.scriptSample || "").toLowerCase();

    return suspiciousPatterns.some((pattern) => pattern.test(blockedUri) || pattern.test(scriptSample));
  }

  private static getAttackIndicators(report: CSPViolationReport): string[] {
    const indicators: string[] = [];

    if (report.blockedUri.includes("javascript:")) {
      indicators.push("javascript_protocol");
    }
    if (report.blockedUri.includes("data:text/html")) {
      indicators.push("data_uri_html");
    }
    if (report.scriptSample?.includes("eval(")) {
      indicators.push("eval_usage");
    }
    if (report.scriptSample?.includes("document.cookie")) {
      indicators.push("cookie_access");
    }

    return indicators;
  }
}
