/**
 * @file main.ts
 * @description Application entrypoint — boots the Hono server and wires global middleware
 */
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { envConfig } from "@config/env.ts";
import { assertBackupStorageSafe } from "@services/db-backup/preflight.ts";
import { assertObjectBackupStorageSafe } from "@services/object-backup/preflight.ts";
import { type HonoContext, OpenAPIHono, Scalar, serveStatic } from "@deps";
import { createLogContextMiddleware, initializeLogContext } from "@logger/log-context.service.ts";
import { tracingMiddleware } from "@middleware/tracing.middleware.ts";
import { jobTriggerMiddleware } from "@middleware/job-trigger.middleware.ts";
import { superAdminMiddleware } from "./middleware/super-admin.middleware.ts";
import { superAdminGuardMiddleware } from "./middleware/super-admin-guard.middleware.ts";
import { requestContextMiddleware } from "@middleware/request-context.middleware.ts";
import { authMiddleware } from "@middleware/auth.middleware.ts";
import { featureGuardMiddleware } from "@middleware/feature-guard.middleware.ts";
import { zodValidationHook } from "@utils/openapi/openapi-wrapper.ts";

import { getInstanceId } from "@utils/instance-id.ts";

import { setupBaseCors, setupPermissiveSecurity, setupStrictSecurity } from "./security.ts";

import { getThreatIntelligenceService } from "./services/threat-intelligence/index.ts";
import { closeCacheService, warmupCache } from "@services/cache/index.ts";

assertBackupStorageSafe({
  enabled: envConfig.backup.enabled,
  storageType: envConfig.storage.type,
  env: envConfig.env,
});

// Boot-time independence guard for object-storage backup (DD7, fail-closed).
assertObjectBackupStorageSafe({
  enabled: envConfig.objectBackup.enabled,
  isDevOrTest: envConfig.isDevelopment || envConfig.isTest,
  nodeEnvExplicit: Deno.env.get("NODE_ENV") !== undefined,
  sourceType: envConfig.storage.type,
  sourceKey: envConfig.storage.key,
  sourceSecretKey: envConfig.storage.secretKey,
  destination: envConfig.backupStorage,
});

// Get singleton instance via getter function
const threatIntelligenceService = getThreatIntelligenceService();

import { openApiBaseSpec } from "./open-api-base.ts";
import health from "@routes/health/index.ts";
import auth from "@routes/auth/index.ts";
import user from "@routes/user/index.ts";
import adminUI from "@routes/admin-ui/index.ts";
import webhooks from "@routes/webhooks/index.ts";
import debug from "@routes/debug/index.ts";
import mediaStream from "@routes/media-stream/index.ts";
import cspReport from "@routes/csp-report/index.ts";
import environmentConfigUser from "@routes/environment-config-user/index.ts";
import permissions from "@routes/permissions/index.ts";
import notifications from "@routes/notifications/index.ts";
import userEncryption from "@routes/user-encryption/index.ts";
import jobs from "@routes/jobs/index.ts";
import superAdmin from "@routes/super-admin/index.ts";
import documents from "@routes/documents/index.ts";
import publicDocuments from "@routes/documents-public/index.ts";
import notes from "@routes/notes/index.ts";
import notesCollections from "@routes/notes-collections/index.ts";
import notesAttachments from "@routes/notes-attachments/index.ts";
import notesTags from "@routes/notes-tags/index.ts";
import notesPublic from "@routes/notes-public/index.ts";

import { initializeJobs, isWorkerModeEnabled, shutdownJobs } from "@jobs/runners/index.ts";

const applicationInitCommand = new Deno.Command(Deno.execPath(), {
  args: [
    "run",
    "--allow-read",
    "--allow-run",
    "--allow-env",
    "./scripts/init/secrets.ts",
  ],
  stdout: "piped",
  stderr: "piped",
});

const { code, stdout, stderr } = await applicationInitCommand.output();

if (code !== 0) {
  const error = new TextDecoder().decode(stderr);
  throw new Error(`Failed to generate random string: ${error}`);
}
new TextDecoder().decode(stdout).trim();

// =====================================
// Generate unique instance ID for this application instance
const instanceId = getInstanceId();
console.log(`📋 Instance ID: ${instanceId}`);

// Initialize LogContext service with instance ID
initializeLogContext(instanceId);

// =====================================
// Create main app
const app = new OpenAPIHono({ defaultHook: zodValidationHook });

// Apply middleware in correct order
app.use(createLogContextMiddleware()); // 1. LogContext (must be first)
app.use(tracingMiddleware); // 2. Tracing (after LogContext)
app.use(jobTriggerMiddleware); // 3. Job trigger (for event-driven mode)
app.use(requestContextMiddleware); // 4. Unified request context (IP extraction + threat intel)

// Baseline CORS for all routes (ensures headers are present even on auth failures)
setupBaseCors(app);

// Auth middleware for all /api routes except auth and internal endpoints
// Note: IP blocking is now handled by requestContextMiddleware (step 4)
app.use("/api/*", authMiddleware); // 5. Auth
app.use("/api/*", featureGuardMiddleware); // 5b. Feature gate (after auth)
app.use("/api/super-admin/*", superAdminGuardMiddleware); // 6. Super admin guard
app.use("/api/internal/*", superAdminMiddleware); // This conflicts with /internal/__admin route
app.use("/internal/__admin", superAdminMiddleware);
app.use("/internal/__admin/*", superAdminMiddleware);

// =====================================
// Setup sub-apps and security layers
const publicOpenApiApp = new OpenAPIHono({ defaultHook: zodValidationHook });
const privateOpenApiApp = new OpenAPIHono({ defaultHook: zodValidationHook });
const privateInternalOpenApiApp = new OpenAPIHono({ defaultHook: zodValidationHook });

// Setup security with enhanced configurations
setupStrictSecurity(publicOpenApiApp);
setupStrictSecurity(privateOpenApiApp);
setupPermissiveSecurity(privateInternalOpenApiApp); // Less strict for internal

// =====================================
// Setup OpenAPI public routes
publicOpenApiApp.route("/auth", auth);

// Security endpoints (no auth required)
publicOpenApiApp.route("/", cspReport);

// Public document sharing access (download, stream, public shares)
// NOTE: Mounted at /public/documents (not /documents) so its `GET /` route
// (which requires a `shareId` query param) does not shadow the authenticated
// documents list route mounted at /documents below.
privateOpenApiApp.route("/public/documents", publicDocuments);
// NOTE: Mounted at /public/notes (not /notes) so its `GET /` route (which
// requires `shareId`/`shareKey` query params) does not shadow the authenticated
// notes list route mounted at /notes below.
privateOpenApiApp.route("/public/notes", notesPublic);

// =====================================
// Setup OpenAPI hidden routes

privateOpenApiApp.route("/user", user);
privateOpenApiApp.route("/user", userEncryption);
if (envConfig.isDevelopment) {
  privateOpenApiApp.route("/debug", debug);
} else {
  privateOpenApiApp.use("/debug", superAdminMiddleware);
  privateOpenApiApp.use("/debug/*", superAdminMiddleware);
  privateOpenApiApp.route("/debug", debug);
}
privateOpenApiApp.route("/environment-config", environmentConfigUser);
privateOpenApiApp.route("/", permissions);
privateOpenApiApp.route("/", mediaStream);
privateOpenApiApp.route("/notifications", notifications);
privateOpenApiApp.route("/jobs", jobs);

privateOpenApiApp.route("/super-admin", superAdmin);
privateOpenApiApp.route("/documents", documents);
// Specific /notes sub-paths must be registered BEFORE the generic /notes app,
// whose `GET /{id}` route would otherwise match /notes/collections (id="collections"),
// /notes/attachments, and /notes/tags first and return 404.
privateOpenApiApp.route("/notes/collections", notesCollections);
privateOpenApiApp.route("/notes/attachments", notesAttachments);
privateOpenApiApp.route("/notes/tags", notesTags);
privateOpenApiApp.route("/notes", notes);

// =====================================
// Setup internal private routes (Admin UI visualizers)
privateInternalOpenApiApp.route("/", adminUI);

// =====================================
// Mount apps - they remain functional in all environments
// Separate public and private routes to avoid double middleware execution
app.route("/api", publicOpenApiApp);
app.route("/api", privateOpenApiApp);
app.route("/api/internal", privateInternalOpenApiApp); // Internal API routes

// Endpoints/Routes that require no auth
app.route("/", health);
app.route("/api/webhooks", webhooks);

if (envConfig.isDevelopment) {
  app.use("/static/*", serveStatic({ root: "./" }));
}

// =====================================
// Admin UI - Serve Vue.js SPA
// Serve static assets (JS, CSS, images) - must be specific to /assets/* only
app.use(
  "/internal/__admin/assets/*",
  serveStatic({
    root: "./admin-ui/dist",
    rewriteRequestPath: (path) => path.replace(/^\/internal\/__admin/, ""),
  }),
);

// Serve index.html for SPA routing
const serveAdminUI = async (c: HonoContext) => {
  try {
    const html = await Deno.readTextFile("./admin-ui/dist/index.html");
    return c.html(html);
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Failed to serve admin UI",
      section: loggerAppSections.INTERNAL,
      messageKey: "admin_ui.serve_failed",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return c.html("<h1>500 - Admin UI Error</h1><p>Failed to load admin interface.</p>", 500);
  }
};

// Base route (with and without trailing slash)
app.get("/internal/__admin", serveAdminUI);
app.get("/internal/__admin/", serveAdminUI);

// Catch-all for client-side routing - exclude /assets/ which is handled by serveStatic
app.get("/internal/__admin/*", (c, next) => {
  const path = c.req.path;
  // Skip SPA handler for static assets
  if (path.includes("/assets/")) {
    return next();
  }
  return serveAdminUI(c);
});

// =====================================
// Setup OpenAPI UI and API Reference
app.get(
  "/openapi",
  Scalar(
    { url: "/docs" },
  ),
);

// Serve OpenAPI spec
if (envConfig.isDevelopment) {
  app.get("/docs", (c) => {
    const spec = app.getOpenAPIDocument(openApiBaseSpec);

    // Filter out tags that have no registered routes
    const usedTags = new Set<string>();
    for (const path of Object.values(spec.paths)) {
      for (const method of Object.values(path)) {
        if (method?.tags) method.tags.forEach((t: string) => usedTags.add(t));
      }
    }
    spec.tags = spec.tags?.filter((t: { name: string }) => usedTags.has(t.name));

    // Ensure securitySchemes are preserved
    spec.components = {
      ...spec.components,
      securitySchemes: openApiBaseSpec.components.securitySchemes,
    };

    return c.json(spec);
  });
} else {
  const publicOnlyApp = new OpenAPIHono({ defaultHook: zodValidationHook });
  publicOnlyApp.route("/api", publicOpenApiApp);
  publicOnlyApp.route("/api/webhooks", webhooks);
  publicOnlyApp.route("/", health);

  app.get("/docs", (c) => {
    const spec = publicOnlyApp.getOpenAPIDocument(openApiBaseSpec);

    // Filter out tags that have no registered routes
    const usedTags = new Set<string>();
    for (const path of Object.values(spec.paths)) {
      for (const method of Object.values(path)) {
        if (method?.tags) method.tags.forEach((t: string) => usedTags.add(t));
      }
    }
    spec.tags = spec.tags?.filter((t: { name: string }) => usedTags.has(t.name));

    spec.components = {
      ...spec.components,
      securitySchemes: openApiBaseSpec.components.securitySchemes,
    };

    return c.json(spec);
  });
}

// =====================================
// Initialize tracing system (simplified - no startup validation needed)
if (envConfig.tracing.enabled) {
  console.log("🔍 Distributed tracing enabled (error-only collection)");
}

// =====================================
// Deferred background initialization
// -------------------------------------
// Cache warmup, threat-intelligence (bloom filter) build, and scheduled-jobs
// init are all expensive and previously kicked off DURING module evaluation,
// competing with the server coming up on the single-threaded event loop. They
// are non-blocking from a control-flow standpoint, but their synchronous chunks
// and DB I/O still delayed the first requests being served.
//
// We now schedule them via `setTimeout(0)` (see below). `deno serve` starts
// accepting requests only after this module's top-level evaluation finishes; a
// macrotask therefore runs AFTER the server is listening, so the server is
// available to take requests while threat-intel and jobs warm up behind it.
function startBackgroundServices(): void {
  // --- Cache warmup ---------------------------------------------------------
  // The cache backend connects lazily on first use; without this, the first
  // request (e.g. login) pays the full connection handshake cost on its hot path.
  warmupCache().then(() => {
    useLogger(
      LoggerLevels.info,
      {
        message: "Cache warmup COMPLETE",
        section: loggerAppSections.INTERNAL,
        messageKey: "app.cache.warmup-complete",
      },
      true,
      true,
    );
  }).catch((error) => {
    useLogger(LoggerLevels.error, {
      message: "Cache warmup failed",
      section: loggerAppSections.INTERNAL,
      messageKey: "app.cache.warmup-failed",
      details: { error: String(error) },
    });
  });

  // --- Threat intelligence (bloom filter) -----------------------------------
  useLogger(
    LoggerLevels.info,
    {
      message: "Starting threat intelligence initialization (background)",
      section: loggerAppSections.INTERNAL,
      messageKey: "app.threat-intel.init-start",
    },
    true,
    true,
  );
  threatIntelligenceService.initialize().then(() => {
    useLogger(
      LoggerLevels.info,
      {
        message: "Threat intelligence initialization COMPLETE",
        section: loggerAppSections.INTERNAL,
        messageKey: "app.threat-intel.init-complete",
      },
      true,
      true,
    );
  }).catch((error) => {
    useLogger(LoggerLevels.error, {
      message: "Failed to initialize threat intelligence",
      section: loggerAppSections.INTERNAL,
      messageKey: "app.threat-intel.init-failed",
      details: { error: String(error) },
    });
  });

  // --- Scheduled jobs -------------------------------------------------------
  // Note: With JOBS_USE_WORKER=true, jobs run in a separate thread
  useLogger(
    LoggerLevels.info,
    {
      message: "Starting jobs initialization (background)",
      section: loggerAppSections.INTERNAL,
      messageKey: "app.jobs.init-start",
    },
    true,
    true,
  );
  initializeJobs(instanceId).then(() => {
    useLogger(
      LoggerLevels.info,
      {
        message: "Jobs initialization COMPLETE",
        section: loggerAppSections.INTERNAL,
        messageKey: "app.jobs.init-complete",
      },
      true,
      true,
    );
  }).catch((error) => {
    useLogger(LoggerLevels.error, {
      message: "Failed to initialize jobs",
      section: loggerAppSections.INTERNAL,
      messageKey: "app.jobs.init-failed",
      details: { error: String(error) },
    });
  });
}

// =====================================
// Global graceful shutdown handler
async function handleGracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

  try {
    // Shutdown job worker if running
    if (isWorkerModeEnabled()) {
      console.log("  ⏹️  Shutting down job worker...");
      await shutdownJobs();
    }

    console.log("  ⏹️  Closing cache service...");
    await closeCacheService();

    console.log("✅ Shutdown complete");
    Deno.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    Deno.exit(1);
  }
}

// Register shutdown handlers
Deno.addSignalListener("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
Deno.addSignalListener("SIGINT", () => handleGracefulShutdown("SIGINT"));

// =====================================
// Start the server
useLogger(
  LoggerLevels.info,
  {
    message: `Starting server`,
    section: loggerAppSections.INTERNAL,
    messageKey: "app.server.starting",
  },
  true,
  true,
);
useLogger(
  LoggerLevels.info,
  {
    message: "SERVER EXPORT READY - should be listening NOW",
    section: loggerAppSections.INTERNAL,
    messageKey: "app.server.ready",
  },
  true,
  true,
);

// Defer heavy background initialization (cache warmup, threat intelligence /
// bloom filter, scheduled jobs) until AFTER `deno serve` has begun accepting
// requests. A timer callback is a macrotask, which only runs once this module's
// top-level evaluation has returned and the runtime has started the server's
// accept loop — so the web server is available to take requests first.
setTimeout(() => {
  startBackgroundServices();
}, 0);

export default {
  fetch(req: Request, info: Deno.ServeHandlerInfo) {
    return app.fetch(req, { connInfo: info });
  },
};
