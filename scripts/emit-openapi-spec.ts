/**
 * @file scripts/emit-openapi-spec.ts
 * @description Emit the rendered OpenAPI document to a JSON file + print readiness stats.
 *
 * Builds the same document `GET /docs` serves (mirrors scripts/check-openapi-docs.ts
 * mounting) and writes it to `openapi.spec.json` (gitignored — an intermediate for
 * `deno task generate:api-types`). Also prints generator-readiness stats for the
 * v2 Step 0 check.
 */
import { OpenAPIHono } from "@deps";
import { zodValidationHook } from "@utils/openapi/openapi-wrapper.ts";
import { openApiBaseSpec } from "../open-api-base.ts";

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
import health from "@routes/health/index.ts";

const mk = () => new OpenAPIHono({ defaultHook: zodValidationHook });
const publicApp = mk();
const privateApp = mk();
const internalApp = mk();
const app = mk();

publicApp.route("/auth", auth);
publicApp.route("/", cspReport);
privateApp.route("/public/documents", publicDocuments);
privateApp.route("/public/notes", notesPublic);
privateApp.route("/user", user);
privateApp.route("/user", userEncryption);
privateApp.route("/debug", debug);
privateApp.route("/environment-config", environmentConfigUser);
privateApp.route("/", permissions);
privateApp.route("/", mediaStream);
privateApp.route("/notifications", notifications);
privateApp.route("/jobs", jobs);
privateApp.route("/super-admin", superAdmin);
privateApp.route("/documents", documents);
privateApp.route("/notes/collections", notesCollections);
privateApp.route("/notes/attachments", notesAttachments);
privateApp.route("/notes/tags", notesTags);
privateApp.route("/notes", notes);
internalApp.route("/", adminUI);
app.route("/api", publicApp);
app.route("/api", privateApp);
app.route("/api/internal", internalApp);
app.route("/", health);
app.route("/api/webhooks", webhooks);

const spec = app.getOpenAPIDocument(openApiBaseSpec) as Record<string, unknown>;

// ---- Write the spec file (intermediate for the type generator) ----
const outPath = new URL("../openapi.spec.json", import.meta.url);
Deno.writeTextFileSync(outPath, JSON.stringify(spec, null, 2));

// ---- Readiness stats (v2 Step 0) ----
const paths = (spec.paths ?? {}) as Record<string, Record<string, { operationId?: string }>>;
const components = (spec.components ?? {}) as { schemas?: Record<string, unknown> };
const schemaNames = Object.keys(components.schemas ?? {});
let opCount = 0;
let missingOpId = 0;
const methods = ["get", "post", "put", "delete", "patch", "head", "options", "trace"];
for (const pathObj of Object.values(paths)) {
  for (const m of methods) {
    const op = pathObj[m];
    if (!op) continue;
    opCount++;
    if (!op.operationId) missingOpId++;
  }
}

console.log("✅ Wrote openapi.spec.json");
console.log(`   paths: ${Object.keys(paths).length}`);
console.log(`   operations: ${opCount} (missing operationId: ${missingOpId})`);
console.log(`   registered component schemas: ${schemaNames.length}`);
console.log(`   sample component names: ${schemaNames.slice(0, 12).join(", ")}`);
console.log(
  schemaNames.length > 12 ? `   …and ${schemaNames.length - 12} more` : "",
);

// Exit explicitly: importing the app graph connects Redis / warms the cache,
// leaving background handles that keep the event loop alive. Without this the
// process never terminates, so a chained `&& openapi-typescript ...` never runs.
Deno.exit(0);
