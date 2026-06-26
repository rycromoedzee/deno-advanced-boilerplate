/**
 * @file services/documents-encryption/encryption-sharing.service.ts
 * @description Document-specific encryption-sharing service — delegates to generic EncryptionSharingService
 *
 * This service is now a thin wrapper around the generic EncryptionSharingService
 * from @services/encryption. It preserves the existing public API for backward
 * compatibility while centralizing all encryption-sharing logic in the encryption layer.
 */

import { EncryptionSharingService } from "@services/encryption/encryption-sharing.service.ts";
import type { IPermissionInheritanceResult } from "@interfaces/documents.ts";
import { tenantTables } from "@db/index.ts";

const DOC_TABLE_CONFIG = {
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
} as const;

export class DocumentEncryptionSharingService {
  private encryptionSharingService: EncryptionSharingService;

  constructor() {
    this.encryptionSharingService = new EncryptionSharingService(DOC_TABLE_CONFIG);
  }

  /**
   * Gets the encryption mode for a document.
   */
  async getDocumentEncryptionMode(documentId: string): Promise<string> {
    return await this.encryptionSharingService.getEncryptionMode(documentId);
  }

  /**
   * Shares an APP_CONTROLLED encrypted document with a user.
   * Copies the owner's encrypted master key to the recipient.
   */
  async shareAppEncryptedDocument(
    documentId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: string | number,
  ): Promise<void> {
    return await this.encryptionSharingService.shareAppEncrypted(
      documentId,
      fromUserId,
      toUserId,
      permissionLevel,
    );
  }

  /**
   * Shares a USER_CONTROLLED encrypted document using ECIES asymmetric encryption.
   */
  async shareUserEncryptedDocument(
    documentId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: string | number,
    ownerUserMasterKey: Uint8Array,
  ): Promise<void> {
    return await this.encryptionSharingService.shareUserEncrypted(
      documentId,
      fromUserId,
      toUserId,
      permissionLevel,
      ownerUserMasterKey,
    );
  }

  /**
   * Batch shares multiple documents with a user.
   * Handles mixed encryption modes (APP_CONTROLLED and USER_CONTROLLED).
   */
  async batchShareDocuments(
    documentIds: string[],
    fromUserId: string,
    toUserId: string,
    permissionLevel: string | number,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<IPermissionInheritanceResult[]> {
    return await this.encryptionSharingService.batchShare(
      documentIds,
      fromUserId,
      toUserId,
      permissionLevel,
      ownerUserMasterKey,
    ) as unknown as IPermissionInheritanceResult[];
  }
}
