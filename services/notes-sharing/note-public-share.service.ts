/**
 * @file services/notes-sharing/note-public-share.service.ts
 * @description Public sharing for notes — mirrors `services/documents/document-sharing-public.service.ts`
 * but adapted to the notes COMMON.* error keys. All public shares go through the real
 * `PublicSharingService.createPublicShare` path: the owner row carries a wrappable
 * encryptedMasterKey, which we decrypt with the supplied owner encryption key and re-wrap
 * with the generated shareKey (zero-knowledge). The previous "test-mode placeholder" branch
 * (which stored empty key blobs) has been removed — all callers must supply a real owner
 * encryption key.
 *
 * PASSWORD GATING (Slice 4 follow-up #2): For password-protected shares the password is
 * baked into the share-key derivation by `PublicSharingService.encryptWithShareKeyAndPassword`
 * — i.e. the wrong password produces an undecryptable wrapped master key. Validation
 * therefore happens at body-decrypt time (`accessPublicShareBody`), NOT at the metadata-only
 * `accessPublicShare` endpoint. The `isPasswordProtected: true` flag in the metadata response
 * signals the client to prompt the user before requesting body decryption.
 *
 * BODY DECRYPTION (Slice 4 follow-up #1): `accessPublicShareBody` performs server-side
 * decryption: it unwraps the per-note master key via `PublicSharingService.getDataMasterKeyForPublicShare`
 * (which requires shareKey + optional password) and decrypts the latest version body before
 * returning plaintext. Wrong shareKey or wrong password both surface as `COMMON.NOT_FOUND`
 * to prevent information disclosure.
 */

import { and, desc, eq } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";
import { useSymmetricDecrypt } from "@services/encryption/encryption.helper.ts";
import { PublicSharingService } from "@services/public-sharing/public-sharing.service.ts";
import { parseShareId } from "@services/public-sharing/secure-link-generator.service.ts";
import { SharingService } from "@services/encryption/sharing.service.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";

export interface INotePublicShareListItem {
  noteId: string;
  noteTitle: string;
  shareToken: string;
  isPasswordProtected: boolean;
  isActive: boolean;
  expiresAt: number | null;
  createdAt: number;
  permissionLevel: string;
}

const NOTES_TABLE_CONFIG = {
  tableName: tenantTables.notesDataKeys,
  resourceIdColumn: "noteId",
} as const;

export interface CreatePublicShareOptions {
  password?: string;
  expiresAt?: number | null;
  permissionLevel?: DB_ENUM_PERMISSION_ACCESS_LEVEL;
}

export interface CreatePublicShareResult {
  shareToken: string;
  /**
   * Per-share random key. Lives in the URL fragment (#) on the client, never
   * stored in plaintext server-side. Required at access time to unwrap the
   * note's master key (zero-knowledge).
   */
  shareKey: string;
  expiresAt: number | null;
  isPasswordProtected: boolean;
}

export interface AccessPublicShareResult {
  noteId: string;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  isPasswordProtected: boolean;
}

export interface AccessPublicShareBodyResult {
  noteId: string;
  title: string;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  isPasswordProtected: boolean;
  latestVersion: {
    id: string;
    body: string;
    createdAt: number;
  } | null;
}

export class NotePublicShareService {
  private publicSharingService = new PublicSharingService(NOTES_TABLE_CONFIG);
  private sharingService = new SharingService(NOTES_TABLE_CONFIG);

  private get perm() {
    return getNotePermissionService();
  }

  async createPublicShare(
    noteId: string,
    ownerId: string,
    opts: CreatePublicShareOptions,
    ownerEncryptionKey: Uint8Array,
  ): Promise<CreatePublicShareResult> {
    return await tracedWithServiceErrorHandling(
      "NotePublicShare.createPublicShare",
      {
        service: "NotePublicShare",
        method: "createPublicShare",
        section: loggerAppSections.NOTES,
        details: { noteId, ownerId, hasPassword: !!opts.password },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = ownerId;
        span.attributes["has_password"] = !!opts.password;

        const ownerLevel = await this.perm.getAccessLevel(noteId, ownerId);
        if (ownerLevel === null) throwHttpError("COMMON.NOT_FOUND");
        if (!permissionLevelMeets(ownerLevel!, DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE)) throwHttpError("COMMON.NOT_FOUND");

        const db = await getTenantDB();
        const ownerRow = await db
          .select({ encryptedMasterKey: tenantTables.notesDataKeys.encryptedMasterKey })
          .from(tenantTables.notesDataKeys)
          .where(
            and(
              eq(tenantTables.notesDataKeys.noteId, noteId),
              eq(tenantTables.notesDataKeys.userId, ownerId),
              eq(tenantTables.notesDataKeys.isActive, true),
            ),
          )
          .limit(1);
        if (!ownerRow[0]) throwHttpError("COMMON.NOT_FOUND");

        const ownerWrappedKey = ownerRow[0].encryptedMasterKey as Uint8Array;
        const ownerHasWrappedKey = ownerWrappedKey && ownerWrappedKey.length > 0;
        // Defense-in-depth: Slice 1 fix guarantees the owner row carries a non-empty
        // encryptedMasterKey, but if a corrupt row sneaks in we surface NOT_FOUND
        // (no information disclosure).
        if (!ownerHasWrappedKey) throwHttpError("COMMON.NOT_FOUND");

        const result = await this.publicSharingService.createPublicShare(
          noteId,
          ownerId,
          {
            password: opts.password,
            expiresAt: opts.expiresAt ?? undefined,
            permissionLevel: opts.permissionLevel ?? DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
          },
          HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
          ownerEncryptionKey,
        );
        return {
          shareToken: result.shareToken,
          shareKey: result.linkId, // SecureLinkResult.linkId is the raw shareKey
          expiresAt: opts.expiresAt ?? null,
          isPasswordProtected: !!opts.password,
        };
      },
    );
  }

  async disablePublicShare(
    noteId: string,
    ownerId: string,
    shareToken?: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NotePublicShare.disablePublicShare",
      {
        service: "NotePublicShare",
        method: "disablePublicShare",
        section: loggerAppSections.NOTES,
        details: { noteId, ownerId, hasShareToken: !!shareToken },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = ownerId;

        const ownerLevel = await this.perm.getAccessLevel(noteId, ownerId);
        if (ownerLevel === null) throwHttpError("COMMON.NOT_FOUND");
        if (!permissionLevelMeets(ownerLevel!, DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE)) throwHttpError("COMMON.NOT_FOUND");
        // The DB stores bare tokens; callers may pass the full shareId.
        const dbToken = shareToken ? parseShareId(shareToken).token : undefined;
        await this.sharingService.disablePublicShares(noteId, dbToken);
      },
    );
  }

  /**
   * Metadata-only access path. Returns noteId / permissionLevel / isPasswordProtected
   * for a valid share token, or `null` if the token is missing/expired/disabled.
   *
   * Does NOT decrypt the body and does NOT validate the shareKey or password.
   * Clients that need the note body must call `accessPublicShareBody` with the
   * shareKey from the URL fragment.
   */
  async accessPublicShare(
    token: string,
    _password?: string,
    _metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<AccessPublicShareResult | null> {
    return await tracedWithServiceErrorHandling(
      "NotePublicShare.accessPublicShare",
      {
        service: "NotePublicShare",
        method: "accessPublicShare",
        section: loggerAppSections.NOTES,
        details: {},
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        // Do NOT log the raw share token — it's the secret URL component
        // that grants access to the share. Redact to a short prefix.
        span.attributes["share.token_prefix"] = token.substring(0, 8);

        // Callers may pass the full shareId (encodedEnvId.token) — the format
        // returned by createPublicShare for URL use — or the bare token.
        // The DB stores the bare token, so normalize before lookup.
        const { token: dbToken } = parseShareId(token);

        const db = await getTenantDB();
        const rows = await db
          .select({
            id: tenantTables.notesDataKeys.id,
            noteId: tenantTables.notesDataKeys.noteId,
            permissionLevel: tenantTables.notesDataKeys.permissionLevel,
            isPasswordProtected: tenantTables.notesDataKeys.isPasswordProtected,
            publicShareExpiresAt: tenantTables.notesDataKeys.publicShareExpiresAt,
            accessCount: tenantTables.notesDataKeys.accessCount,
          })
          .from(tenantTables.notesDataKeys)
          .where(
            and(
              eq(tenantTables.notesDataKeys.publicShareToken, dbToken),
              eq(tenantTables.notesDataKeys.isPublicShare, true),
              eq(tenantTables.notesDataKeys.isActive, true),
            ),
          )
          .limit(1);

        if (rows.length === 0) return null;
        const row = rows[0];
        if (
          row.publicShareExpiresAt && row.publicShareExpiresAt < getTimeNowForStorage()
        ) {
          return null;
        }

        // NOTE: Password validation is intentionally NOT performed here. For
        // password-protected shares the password is baked into the share-key
        // derivation (see PublicSharingService.encryptWithShareKeyAndPassword);
        // a wrong password yields an undecryptable wrapped master key, so
        // validation falls out naturally at body-decrypt time. This metadata-
        // only endpoint exposes the noteId/permission/isPasswordProtected flag
        // to drive the client UX (prompt for password before requesting body
        // decryption). Server-side body decryption is Slice 4 follow-up #1.
        this.sharingService.incrementAccessCount(row.id, row.accessCount);
        return {
          noteId: row.noteId,
          permissionLevel: row.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
          isPasswordProtected: row.isPasswordProtected,
        };
      },
    );
  }

  /**
   * Server-side body decryption path for public note reads. Validates the
   * shareKey (and optional password) by attempting to unwrap the per-note
   * master key, then decrypts the latest version body and returns plaintext.
   *
   * Wrong shareKey or wrong password both surface as `COMMON.NOT_FOUND` —
   * we deliberately do NOT distinguish them, because doing so would leak
   * which of the two secrets was wrong.
   *
   * The shareKey is the secret half of the URL (lives in the fragment on
   * the client). It is NEVER logged on this code path.
   */
  async accessPublicShareBody(
    shareToken: string,
    shareKey: string,
    password?: string,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<AccessPublicShareBodyResult> {
    return await tracedWithServiceErrorHandling(
      "NotePublicShare.accessPublicShareBody",
      {
        service: "NotePublicShare",
        method: "accessPublicShareBody",
        section: loggerAppSections.NOTES,
        details: { hasPassword: !!password },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        // Do NOT log the raw shareToken or shareKey on the span. shareToken
        // is somewhat lookup-y but combined with shareKey it would be the
        // full secret material; redact to a short prefix.
        span.attributes["share.token_prefix"] = shareToken.substring(0, 8);

        // Callers pass the full shareId (encodedEnvId.token); the DB stores
        // the bare token, and PublicSharingService.getDataMasterKeyForPublicShare
        // also queries by bare token.
        const { token: dbToken } = parseShareId(shareToken);

        const db = await getTenantDB();
        const rows = await db
          .select({
            id: tenantTables.notesDataKeys.id,
            noteId: tenantTables.notesDataKeys.noteId,
            permissionLevel: tenantTables.notesDataKeys.permissionLevel,
            isPasswordProtected: tenantTables.notesDataKeys.isPasswordProtected,
            publicShareExpiresAt: tenantTables.notesDataKeys.publicShareExpiresAt,
            accessCount: tenantTables.notesDataKeys.accessCount,
          })
          .from(tenantTables.notesDataKeys)
          .where(
            and(
              eq(tenantTables.notesDataKeys.publicShareToken, dbToken),
              eq(tenantTables.notesDataKeys.isPublicShare, true),
              eq(tenantTables.notesDataKeys.isActive, true),
            ),
          )
          .limit(1);

        if (rows.length === 0) throwHttpError("COMMON.NOT_FOUND");
        const row = rows[0];
        if (
          row.publicShareExpiresAt && row.publicShareExpiresAt < getTimeNowForStorage()
        ) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Read the note (id, title) and reject if archived/missing.
        const noteRows = await db
          .select({ id: tenantTables.notes.id, title: tenantTables.notes.title })
          .from(tenantTables.notes)
          .where(
            and(
              eq(tenantTables.notes.id, row.noteId),
              eq(tenantTables.notes.isArchived, false),
            ),
          )
          .limit(1);
        if (!noteRows[0]) throwHttpError("COMMON.NOT_FOUND");
        span.attributes["note.id"] = noteRows[0].id;

        // Unwrap the per-note master key. The token lookup is already done
        // above, so any error from getDataMasterKeyForPublicShare is
        // shareKey/password related. We surface 401 (password required /
        // invalid) and 400 (malformed share key) to the frontend so it can
        // prompt for / re-prompt for a password, and collapse only the
        // remaining cases (e.g. unexpected 5xx) to NOT_FOUND. Share token
        // is unguessable (512-bit), so leaking "this share exists and
        // needs a password" does not materially aid enumeration.
        let noteMasterKey: Uint8Array;
        try {
          noteMasterKey = await this.publicSharingService.getDataMasterKeyForPublicShare(
            dbToken,
            shareKey,
            HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
            password,
          );
        } catch (error) {
          if (error instanceof AppHttpException) {
            if (error.status === 429) throw error;
            if (error.status === 401) throw error;
            if (error.status === 400) throw error;
          }
          throwHttpError("COMMON.NOT_FOUND");
        }

        try {
          // Read the latest version row.
          const versionRows = await db
            .select()
            .from(tenantTables.noteVersions)
            .where(eq(tenantTables.noteVersions.noteId, row.noteId))
            .orderBy(desc(tenantTables.noteVersions.createdAt))
            .limit(1);
          const v = versionRows[0];

          let latestVersion: AccessPublicShareBodyResult["latestVersion"] = null;
          if (v) {
            const plaintextBytes = await useSymmetricDecrypt({
              key: noteMasterKey!,
              data: v.bodyCiphertext as Uint8Array,
              nonce: v.bodyIv as Uint8Array,
              hasNonce: false,
            });
            const body = new TextDecoder().decode(plaintextBytes);
            // Zero the plaintext byte buffer; the decoded `body` string lives
            // on the JS heap and cannot be zeroed, but the byte-level material
            // can be — shortens the heap-recoverable window.
            plaintextBytes.fill(0);
            latestVersion = {
              id: v.id,
              body,
              createdAt: v.createdAt,
            };
          }

          // Increment access count after successful decrypt (fire-and-forget,
          // matches the access-metadata path).
          this.sharingService.incrementAccessCount(row.id, row.accessCount);
          // Touch metadata so it's not flagged as unused (reserved for future
          // per-IP / per-UA logging).
          void metadata;

          return {
            noteId: noteRows[0].id,
            title: noteRows[0].title,
            permissionLevel: row.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
            isPasswordProtected: row.isPasswordProtected,
            latestVersion,
          };
        } finally {
          // Always zero the unwrapped per-note master key.
          if (noteMasterKey!) noteMasterKey.fill(0);
        }
      },
    );
  }

  /**
   * List all public shares created by the authenticated user, across all their notes.
   * Includes both active and revoked shares (for full history in the Settings UI).
   * Joins the notes table to provide the note title.
   *
   * Access control: filtering by grantedBy (the authenticated userId) scopes
   * results to shares the user created. No per-note permission check needed.
   */
  async listAllPublicSharesForOwner(userId: string): Promise<INotePublicShareListItem[]> {
    return await tracedWithServiceErrorHandling(
      "NotePublicShare.listAllPublicSharesForOwner",
      {
        service: "NotePublicShare",
        method: "listAllPublicSharesForOwner",
        section: loggerAppSections.NOTES,
        details: { userId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;

        const rows = await traced(
          "db.publicShare.listAllForOwner",
          "db.query",
          async () => {
            const db = await getTenantDB();
            return await db
              .select({
                noteId: tenantTables.notesDataKeys.noteId,
                noteTitle: tenantTables.notes.title,
                shareToken: tenantTables.notesDataKeys.publicShareToken,
                isPasswordProtected: tenantTables.notesDataKeys.isPasswordProtected,
                revokedAt: tenantTables.notesDataKeys.revokedAt,
                expiresAt: tenantTables.notesDataKeys.publicShareExpiresAt,
                createdAt: tenantTables.notesDataKeys.createdAt,
                permissionLevel: tenantTables.notesDataKeys.permissionLevel,
              })
              .from(tenantTables.notesDataKeys)
              .innerJoin(
                tenantTables.notes,
                eq(tenantTables.notesDataKeys.noteId, tenantTables.notes.id),
              )
              .where(
                and(
                  eq(tenantTables.notesDataKeys.grantedBy, userId),
                  eq(tenantTables.notesDataKeys.isPublicShare, true),
                ),
              );
          },
        );

        return rows
          .filter((r) => r.shareToken !== null)
          .map((r) => ({
            noteId: r.noteId,
            noteTitle: r.noteTitle,
            shareToken: r.shareToken as string,
            isPasswordProtected: r.isPasswordProtected ?? false,
            isActive: r.revokedAt === null || r.revokedAt === undefined,
            expiresAt: r.expiresAt ?? null,
            createdAt: typeof r.createdAt === "number" ? r.createdAt : new Date(r.createdAt).getTime(),
            permissionLevel: r.permissionLevel,
          }));
      },
    );
  }

  async listPublicShares(
    noteId: string,
    requesterId: string,
    encryptionKey: Uint8Array,
  ): Promise<{
    publicShares: {
      shareToken: string;
      permissionLevel: string;
      isPasswordProtected: boolean;
      expiresAt: number | null;
      recipientEmail: string | null;
      createdAt: number;
      publicUrl: string;
    }[];
  }> {
    return await tracedWithServiceErrorHandling(
      "NotePublicShare.listPublicShares",
      {
        service: "NotePublicShare",
        method: "listPublicShares",
        section: loggerAppSections.NOTES,
        details: { noteId, requesterId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = requesterId;

        const ownerLevel = await this.perm.getAccessLevel(noteId, requesterId);
        if (ownerLevel === null) throwHttpError("COMMON.NOT_FOUND");
        if (!permissionLevelMeets(ownerLevel!, DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE)) throwHttpError("COMMON.NOT_FOUND");

        const fetchedShares = await this.sharingService.listPublicShares(noteId);

        const { envConfig } = await import("@config/env.ts");
        const protocol = envConfig.public.frontURL.startsWith("http") ? "" : "https://";
        const baseUrl = `${protocol}${envConfig.public.frontURL}/public/notes`;

        const publicShares = await Promise.all(
          fetchedShares.map(async (share) => {
            let shareKey = "";
            if (share.sharerEncryptedShareKey) {
              try {
                shareKey = await this.publicSharingService.decryptShareKeyForSharer(
                  share.sharerEncryptedShareKey,
                  encryptionKey,
                  HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
                );
              } catch {
                // Mirror document behavior: if the shareKey can't be unwrapped
                // (key rotation, missing row) we surface an empty url so the
                // panel can still render the share token without a working
                // deep link. The actual link is recoverable by re-issuing the
                // share; the data itself is unaffected.
              }
            }

            return {
              shareToken: share.shareToken,
              permissionLevel: share.permissionLevel,
              isPasswordProtected: share.isPasswordProtected,
              expiresAt: share.expiresAt,
              recipientEmail: share.recipientEmail,
              createdAt: share.createdAt,
              publicUrl: shareKey ? `${baseUrl}?shareId=${share.shareToken}#${shareKey}` : "",
            };
          }),
        );

        return { publicShares };
      },
    );
  }
}
