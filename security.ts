import { cors, csrf, type HonoContext, OpenAPIHono, secureHeaders } from "@deps";
import { type CSPMode, type CSPOptions, EnhancedCSPService } from "@services/security/enhanced-csp.service.ts";
import { apiInputValidationMiddleware } from "@middleware/input-validation.middleware.ts";
import { getAllowedOrigins } from "@utils/network/index.ts";
import { CORS_ALLOW_HEADERS, CORS_EXPOSE_HEADERS } from "@constants/http-headers.ts";

const buildCorsOptions = () => ({
  origin: getAllowedOrigins(),
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: [...CORS_ALLOW_HEADERS],
  exposeHeaders: [...CORS_EXPOSE_HEADERS],
  credentials: true,
  maxAge: 86400,
});

export const setupBaseCors = (app: OpenAPIHono) => {
  app.use("/*", cors(buildCorsOptions()));
  return app;
};

export const setupEnhancedSecurity = (
  app: OpenAPIHono,
  cspMode: CSPMode = "moderate",
  customCSPOptions?: Partial<CSPOptions>,
  enableInputValidation: boolean = true,
  _enableApiSecurity: boolean = true,
) => {
  // Get CSP options based on mode and custom overrides
  const cspOptions = {
    ...EnhancedCSPService.getPresetOptions(cspMode),
    ...customCSPOptions,
  };

  // Add smart CSP middleware first (sets up context)
  app.use("*", EnhancedCSPService.createSmartCSPMiddleware(cspOptions));

  // Setup Hono's secureHeaders with enhanced CSP
  app.use("*", async (c, next) => {
    // Get the smart CSP policy from context
    // @ts-expect-error - smartCSPPolicy is a context variable
    const smartCSPPolicy = c.get("smartCSPPolicy");

    // Allow cross-origin access for thumbnail preview endpoints
    const isThumbnailPreview = c.req.path.includes("/preview");

    // Apply secureHeaders with the smart CSP policy
    const secureHeadersMiddleware = secureHeaders({
      // Standard security headers
      crossOriginResourcePolicy: isThumbnailPreview ? "cross-origin" : "same-origin",
      crossOriginOpenerPolicy: "same-origin",
      originAgentCluster: "?1",
      referrerPolicy: "no-referrer",
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      xContentTypeOptions: "nosniff",
      xDnsPrefetchControl: "off",
      xDownloadOptions: "noopen",
      xFrameOptions: "SAMEORIGIN",
      xPermittedCrossDomainPolicies: "none",
      xXssProtection: "0",

      // Smart Content Security Policy
      contentSecurityPolicy: smartCSPPolicy,

      // Enhanced Permissions Policy
      permissionsPolicy: {
        // Media permissions
        camera: ["none"],
        microphone: ["none"],
        geolocation: ["none"],

        // Payment and hardware
        payment: ["self"],
        usb: ["none"],
        magnetometer: ["none"],
        gyroscope: ["none"],
        accelerometer: ["none"],
        ambientLightSensor: ["none"],

        // Media playback
        autoplay: ["self"],
        encryptedMedia: ["self"],
        fullscreen: ["self"],
        pictureInPicture: ["self"],
      },
    });

    await secureHeadersMiddleware(c, next);
  });

  // CORS for API routes (with environment-specific origins)
  app.use("/*", cors(buildCorsOptions()));

  // CSRF protection for API routes (skip public endpoints)
  app.use("/*", async (c, next) => {
    const path = c.req.path;
    const method = c.req.method.toUpperCase();

    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return await next();
    }

    if (
      path.startsWith("/auth/") ||
      path.startsWith("/public/") ||
      path.startsWith("/security/csp/report")
    ) {
      return await next();
    }

    return await csrf({ origin: getAllowedOrigins() })(c, next);
  });

  // Input validation middleware for API routes
  if (enableInputValidation) {
    app.use("/*", apiInputValidationMiddleware());
  }

  return app;
};

// Convenience functions for different security levels
export const setupStrictSecurity = (app: OpenAPIHono) =>
  setupEnhancedSecurity(app, "strict", {
    enableNonce: true,
    reportingEndpoint: "/api/security/csp/report",
  });

export const setupPermissiveSecurity = (app: OpenAPIHono) => setupEnhancedSecurity(app, "permissive");

// Helper to access nonce in templates (if nonce is enabled)
export const getCSPNonce = (c: HonoContext): string | null => {
  return c.get("cspNonce") || null;
};
