/**
 * @file scripts/check-openapi-docs.ts
 * @description OpenAPI documentation CI gate
 *
 * Renders the OpenAPI document (the same surface served at GET /docs) and fails
 * if any operation is missing `summary`, `description`, or `operationId`, if any
 * `operationId` collides, or if any tag used by a route lacks a description.
 *
 * Run: `deno task check:openapi-docs`
 *
 * This mirrors main.ts's route mounting (minus boot side effects) so the
 * document it validates is the one users actually see.
 */
import { OpenAPIHono } from "@deps";
import { zodValidationHook } from "@utils/openapi/openapi-wrapper.ts";
import { openApiBaseSpec } from "../open-api-base.ts";
import { openApiTagsSpec } from "@utils/openapi/tags.ts";

// Route sub-apps (same default exports main.ts mounts).
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

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options", "trace"] as const;

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
}

function buildDocument() {
  const publicApp = new OpenAPIHono({ defaultHook: zodValidationHook });
  const privateApp = new OpenAPIHono({ defaultHook: zodValidationHook });
  const internalApp = new OpenAPIHono({ defaultHook: zodValidationHook });
  const app = new OpenAPIHono({ defaultHook: zodValidationHook });

  // Public surface.
  publicApp.route("/auth", auth);
  publicApp.route("/", cspReport);
  privateApp.route("/public/documents", publicDocuments);
  privateApp.route("/public/notes", notesPublic);

  // Authenticated surface.
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
  // Specific /notes sub-paths before the generic /notes app.
  privateApp.route("/notes/collections", notesCollections);
  privateApp.route("/notes/attachments", notesAttachments);
  privateApp.route("/notes/tags", notesTags);
  privateApp.route("/notes", notes);

  // Internal tooling surface.
  internalApp.route("/", adminUI);

  app.route("/api", publicApp);
  app.route("/api", privateApp);
  app.route("/api/internal", internalApp);
  app.route("/", health);
  app.route("/api/webhooks", webhooks);

  return app.getOpenAPIDocument(openApiBaseSpec);
}

function main() {
  const spec = buildDocument();
  const paths = (spec.paths ?? {}) as Record<string, Record<string, OpenApiOperation>>;

  const violations: string[] = [];
  const operationIds = new Map<string, string>(); // operationId -> "METHOD path"
  const usedTags = new Set<string>();

  let operationCount = 0;

  for (const [path, methods] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = methods[method];
      if (!op) continue;
      operationCount++;

      const where = `${method.toUpperCase()} ${path}`;

      if (!op.summary) violations.push(`${where}: missing \`summary\``);
      if (!op.description) violations.push(`${where}: missing \`description\``);
      if (!op.operationId) {
        violations.push(`${where}: missing \`operationId\``);
      } else {
        const prev = operationIds.get(op.operationId);
        if (prev) {
          violations.push(`duplicate \`operationId\` "${op.operationId}" on ${where} (also on ${prev})`);
        } else {
          operationIds.set(op.operationId, where);
        }
      }

      for (const tag of op.tags ?? []) usedTags.add(tag);
    }
  }

  // Every used tag must have a description in openApiTagsSpec.
  const describedTags = new Set(openApiTagsSpec.map((t) => t.name));
  for (const tag of usedTags) {
    if (!describedTags.has(tag)) {
      violations.push(`tag "${tag}" is used by routes but has no description in openApiTagsSpec`);
    }
  }

  console.log(`Checked ${operationCount} operations across ${Object.keys(paths).length} paths.`);

  if (violations.length > 0) {
    console.error(`\n❌ OpenAPI documentation gate failed (${violations.length} violation(s)):\n`);
    for (const v of violations) console.error(`  - ${v}`);
    Deno.exit(1);
  }

  console.log(
    "✅ OpenAPI documentation gate passed: every operation has summary, description, and a unique operationId; all used tags are described.",
  );
}

main();
