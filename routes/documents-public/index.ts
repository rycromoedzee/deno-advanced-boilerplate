/**
 * @file routes/documents-public/index.ts
 * @description Barrel/Hono app wiring for documents public routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import { accessPublicDocumentHandler, registerDocumentPublicAccess } from "@handlers/documents-sharing/index.ts";
import {
  downloadPublicDocumentHandler,
  listPublicFolderDocumentsHandler,
  streamPublicDocumentHandler,
} from "@handlers/documents-public/index.ts";
import {
  accessPublicDocumentRoutePublic,
  downloadPublicDocumentRoutePublic,
  listPublicFolderDocumentsRoutePublic,
  streamPublicDocumentRoutePublic,
} from "./documents-public.route.ts";

// Initialize document public access configuration
registerDocumentPublicAccess();

// Rate limit configurations for public endpoints (stricter than authenticated)
const PUBLIC_RATE_LIMIT = {
  max: 50,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.1,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(downloadPublicDocumentRoutePublic, downloadPublicDocumentHandler, PUBLIC_RATE_LIMIT);
app.openapiWithRateLimit(streamPublicDocumentRoutePublic, streamPublicDocumentHandler, PUBLIC_RATE_LIMIT);
app.openapiWithRateLimit(accessPublicDocumentRoutePublic, accessPublicDocumentHandler, PUBLIC_RATE_LIMIT);
app.openapiWithRateLimit(
  listPublicFolderDocumentsRoutePublic,
  listPublicFolderDocumentsHandler,
  PUBLIC_RATE_LIMIT,
);

export default app;
