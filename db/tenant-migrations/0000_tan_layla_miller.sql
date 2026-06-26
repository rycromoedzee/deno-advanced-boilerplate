CREATE TABLE `api_key_permission_groups` (
	`api_key_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`api_key_id`, `group_id`),
	FOREIGN KEY (`group_id`) REFERENCES `permission_groups`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `api_key_permissions` (
	`api_key_id` text NOT NULL,
	`permission_id` text NOT NULL,
	PRIMARY KEY(`api_key_id`, `permission_id`),
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`api_key_derived_key` blob,
	`key_ending_in` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer,
	`ip_restrictions` text,
	`domain_restrictions` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user_id` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user_id_active` ON `api_keys` (`user_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `backup_deletion_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`delete_after` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_backup_deletion_queue_delete_after` ON `backup_deletion_queue` (`delete_after`);--> statement-breakpoint
CREATE TABLE `document_access_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text,
	`folder_id` text,
	`data_key_id` text,
	`user_id` text,
	`access_type` text NOT NULL,
	`access_method` text NOT NULL,
	`changes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `document_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_access_logs_document_id` ON `document_access_logs` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_document_access_logs_created_at` ON `document_access_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_document_access_logs_user_id` ON `document_access_logs` (`user_id`);--> statement-breakpoint
CREATE TABLE `document_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`parent_comment_id` text,
	`content` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text,
	`is_resolved` integer DEFAULT false NOT NULL,
	`resolved_by_id` text,
	`resolved_by_name` text,
	`resolved_at` integer,
	`is_archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`archived_by_id` text,
	`archived_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_document_comments_document_id` ON `document_comments` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_document_comments_parent_comment_id` ON `document_comments` (`parent_comment_id`);--> statement-breakpoint
CREATE TABLE `document_favorites` (
	`user_id` text NOT NULL,
	`document_id` text,
	`folder_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `document_id`, `folder_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `document_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`parent_folder_id` text,
	`owner_id` text NOT NULL,
	`color` text DEFAULT '#3b82f6',
	`icon` text DEFAULT 'folder',
	`is_public_shared` integer DEFAULT false NOT NULL,
	`public_share_token` text,
	`public_share_expires_at` integer,
	`sharer_encrypted_share_key` blob,
	`has_internal_sharing` integer DEFAULT false NOT NULL,
	`auto_share_new_content` integer DEFAULT true NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_folders_public_share_token_unique` ON `document_folders` (`public_share_token`);--> statement-breakpoint
CREATE INDEX `idx_document_folders_parent_folder_id` ON `document_folders` (`parent_folder_id`);--> statement-breakpoint
CREATE INDEX `idx_document_folders_owner_archived` ON `document_folders` (`owner_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_document_folders_public_share_token` ON `document_folders` (`public_share_token`);--> statement-breakpoint
CREATE INDEX `idx_document_folders_env_parent_archived` ON `document_folders` (`parent_folder_id`,`is_archived`);--> statement-breakpoint
CREATE TABLE `folder_shared_users` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission_level` text DEFAULT 'read' NOT NULL,
	`granted_by_id` text NOT NULL,
	`granted_by_name` text,
	`granted_at` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `document_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_folder_shared_users_unique` ON `folder_shared_users` (`folder_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_shared_users_folder_user_active` ON `folder_shared_users` (`folder_id`,`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_folder_shared_users_user_id` ON `folder_shared_users` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_shared_users_user_active` ON `folder_shared_users` (`user_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `document_metadata_schemas` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`default_value` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_metadata_schemas_user_id` ON `document_metadata_schemas` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_document_metadata_schemas_user_key` ON `document_metadata_schemas` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `document_tag_assignments` (
	`document_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`assigned_by_id` text NOT NULL,
	`assigned_by_name` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`document_id`, `tag_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `document_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6b7280',
	`description` text,
	`user_id` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_by_name` text,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_document_tags_user_id` ON `document_tags` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_document_tags_user_name` ON `document_tags` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`storage_metadata_id` text NOT NULL,
	`folder_id` text,
	`owner_id` text NOT NULL,
	`content_type` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`download_count` integer DEFAULT 0 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`metadata` text DEFAULT '{}',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`storage_metadata_id`) REFERENCES `storage_metadata`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`folder_id`) REFERENCES `document_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_documents_owner_id` ON `documents` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_owner_archived` ON `documents` (`owner_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_documents_folder_id` ON `documents` (`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_folder_archived` ON `documents` (`folder_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_documents_is_archived` ON `documents` (`is_archived`);--> statement-breakpoint
CREATE TABLE `documents_data_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`user_id` text,
	`encrypted_master_key` blob NOT NULL,
	`thumbnail_encrypted_master_key` blob,
	`encryption_mode` text DEFAULT 'app' NOT NULL,
	`permission_level` text DEFAULT 'read' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`is_public_share` integer DEFAULT false NOT NULL,
	`public_share_token` text,
	`public_share_expires_at` integer,
	`sharer_encrypted_share_key` blob,
	`recipient_email` text,
	`recipient_name` text,
	`recipient_language` text DEFAULT 'en',
	`is_password_protected` integer DEFAULT false NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`notify_on_access` integer DEFAULT false NOT NULL,
	`granted_at` integer NOT NULL,
	`revoked_at` integer,
	`granted_by` text,
	`granted_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_data_keys_public_share_token_unique` ON `documents_data_keys` (`public_share_token`);--> statement-breakpoint
CREATE INDEX `idx_documents_data_keys_document_id` ON `documents_data_keys` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_data_keys_document_user` ON `documents_data_keys` (`document_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_data_keys_document_user_active` ON `documents_data_keys` (`document_id`,`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_documents_data_keys_user_id` ON `documents_data_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_data_keys_granted_by_active` ON `documents_data_keys` (`granted_by`,`is_active`);--> statement-breakpoint
CREATE TABLE `environment_notification_defaults` (
	`notification_type_id` text PRIMARY KEY NOT NULL,
	`email_enabled` integer NOT NULL,
	`in_app_enabled` integer NOT NULL,
	`push_enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notification_type_id`) REFERENCES `notification_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `folder_access_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`user_id` text,
	`access_type` text NOT NULL,
	`access_method` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`referer` text,
	`success` integer DEFAULT true NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `document_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_folder_access_logs_folder_id` ON `folder_access_logs` (`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_access_logs_user_id` ON `folder_access_logs` (`user_id`);--> statement-breakpoint
CREATE TABLE `master_key_rotation_escrow` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_new_master_key` blob NOT NULL,
	`key_derivation_nonce` text NOT NULL,
	`pending_credential_ids` text NOT NULL,
	`master_key_version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `note_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`original_name` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`storage_key` text NOT NULL,
	`iv_blob` blob,
	`backed_up_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_note_attachments_note` ON `note_attachments` (`note_id`);--> statement-breakpoint
CREATE INDEX `idx_note_attachments_owner` ON `note_attachments` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_note_attachments_backed_up_at` ON `note_attachments` (`backed_up_at`);--> statement-breakpoint
CREATE TABLE `note_attachments_data_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`note_attachment_id` text NOT NULL,
	`user_id` text,
	`encrypted_master_key` blob NOT NULL,
	`encryption_mode` text DEFAULT 'app' NOT NULL,
	`permission_level` text DEFAULT 'read' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`is_public_share` integer DEFAULT false NOT NULL,
	`public_share_token` text,
	`public_share_expires_at` integer,
	`sharer_encrypted_share_key` blob,
	`recipient_email` text,
	`recipient_name` text,
	`recipient_language` text DEFAULT 'en',
	`is_password_protected` integer DEFAULT false NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`notify_on_access` integer DEFAULT false NOT NULL,
	`granted_at` integer NOT NULL,
	`revoked_at` integer,
	`granted_by` text,
	`granted_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`note_attachment_id`) REFERENCES `note_attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_attachments_data_keys_public_share_token_unique` ON `note_attachments_data_keys` (`public_share_token`);--> statement-breakpoint
CREATE INDEX `idx_note_attachments_data_keys_attachment_id` ON `note_attachments_data_keys` (`note_attachment_id`);--> statement-breakpoint
CREATE INDEX `idx_note_attachments_data_keys_attachment_user` ON `note_attachments_data_keys` (`note_attachment_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_note_attachments_data_keys_attachment_user_active` ON `note_attachments_data_keys` (`note_attachment_id`,`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_note_attachments_data_keys_user_id` ON `note_attachments_data_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `note_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`color` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`metadata` text,
	`auto_share_new_content` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_note_collections_owner` ON `note_collections` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_note_collections_owner_archived` ON `note_collections` (`owner_id`,`is_archived`);--> statement-breakpoint
CREATE TABLE `note_collection_shared_users` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission_level` text DEFAULT 'read' NOT NULL,
	`granted_by_id` text NOT NULL,
	`granted_by_name` text,
	`granted_at` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `note_collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_note_coll_shared_users_unique` ON `note_collection_shared_users` (`collection_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_note_coll_shared_users_coll_user_active` ON `note_collection_shared_users` (`collection_id`,`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_note_coll_shared_users_user_id` ON `note_collection_shared_users` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_note_coll_shared_users_user_active` ON `note_collection_shared_users` (`user_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `note_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6b7280',
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_note_tags_owner` ON `note_tags` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_note_tags_owner_name` ON `note_tags` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `note_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body_ciphertext` blob NOT NULL,
	`body_iv` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_note_versions_note` ON `note_versions` (`note_id`);--> statement-breakpoint
CREATE INDEX `idx_note_versions_note_created` ON `note_versions` (`note_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_note_versions_note_author_created` ON `note_versions` (`note_id`,`author_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`collection_id` text,
	`title` text NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`is_pinned` integer DEFAULT false NOT NULL,
	`last_version_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `note_collections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_notes_owner` ON `notes` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_owner_archived` ON `notes` (`owner_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_notes_collection` ON `notes` (`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_owner_pinned` ON `notes` (`owner_id`,`is_pinned`);--> statement-breakpoint
CREATE TABLE `notes_data_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`user_id` text,
	`encrypted_master_key` blob NOT NULL,
	`encryption_mode` text DEFAULT 'app' NOT NULL,
	`permission_level` text DEFAULT 'read' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`is_public_share` integer DEFAULT false NOT NULL,
	`public_share_token` text,
	`public_share_expires_at` integer,
	`sharer_encrypted_share_key` blob,
	`recipient_email` text,
	`recipient_name` text,
	`recipient_language` text DEFAULT 'en',
	`is_password_protected` integer DEFAULT false NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`notify_on_access` integer DEFAULT false NOT NULL,
	`granted_at` integer NOT NULL,
	`revoked_at` integer,
	`granted_by` text,
	`granted_by_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notes_data_keys_public_share_token_unique` ON `notes_data_keys` (`public_share_token`);--> statement-breakpoint
CREATE INDEX `idx_notes_data_keys_note_id` ON `notes_data_keys` (`note_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_data_keys_note_user` ON `notes_data_keys` (`note_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_data_keys_note_user_active` ON `notes_data_keys` (`note_id`,`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_notes_data_keys_user_id` ON `notes_data_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_data_keys_user_active` ON `notes_data_keys` (`user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_notes_data_keys_granted_by_active` ON `notes_data_keys` (`granted_by`,`is_active`);--> statement-breakpoint
CREATE TABLE `notification_types` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`scope` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`default_email` integer DEFAULT true NOT NULL,
	`default_in_app` integer DEFAULT true NOT NULL,
	`default_push` integer DEFAULT false NOT NULL,
	`available_channels` text DEFAULT 'email,inApp,push' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notification_types_category` ON `notification_types` (`category`);--> statement-breakpoint
CREATE INDEX `idx_notification_types_scope` ON `notification_types` (`scope`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title_key` text NOT NULL,
	`body_key` text NOT NULL,
	`action_route` text NOT NULL,
	`resource_id` text,
	`actor_id` text,
	`actor_name` text,
	`is_read` integer DEFAULT false NOT NULL,
	`dismissed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_created` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_is_read` ON `notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE TABLE `permission_group_permissions` (
	`group_id` text NOT NULL,
	`permission_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `permission_id`),
	FOREIGN KEY (`group_id`) REFERENCES `permission_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `permission_group_permissions_group_id_idx` ON `permission_group_permissions` (`group_id`);--> statement-breakpoint
CREATE INDEX `permission_group_permissions_permission_id_idx` ON `permission_group_permissions` (`permission_id`);--> statement-breakpoint
CREATE TABLE `permission_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`level` integer,
	`group_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_name_unique` ON `permissions` (`name`);--> statement-breakpoint
CREATE TABLE `storage_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`original_file_size` integer DEFAULT 0 NOT NULL,
	`encrypted_file_size` integer DEFAULT 0 NOT NULL,
	`folder_path` text NOT NULL,
	`user_id` text NOT NULL,
	`encryption_chunk_size` integer DEFAULT 524288 NOT NULL,
	`content_hash` text,
	`duplicate_allowed` integer DEFAULT false NOT NULL,
	`thumbnail_path` text,
	`thumbnail_size` integer,
	`thumbnail_width` integer,
	`thumbnail_height` integer,
	`backed_up_at` integer,
	`thumbnail_backed_up_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_storage_metadata_content_hash` ON `storage_metadata` (`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_storage_metadata_user_content_hash` ON `storage_metadata` (`user_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_storage_metadata_backed_up_at` ON `storage_metadata` (`backed_up_at`);--> statement-breakpoint
CREATE TABLE `tags_on_notes` (
	`note_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`added_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`note_id`, `tag_id`, `added_by_user_id`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `note_tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tags_on_notes_note` ON `tags_on_notes` (`note_id`);--> statement-breakpoint
CREATE INDEX `idx_tags_on_notes_tag` ON `tags_on_notes` (`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_tags_on_notes_added_by` ON `tags_on_notes` (`added_by_user_id`);--> statement-breakpoint
CREATE TABLE `user_backup_codes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`backup_codes` blob,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_encryption` (
	`user_id` text PRIMARY KEY NOT NULL,
	`is_enhanced_encryption_enabled` integer DEFAULT false NOT NULL,
	`encrypted_master_key_by_password` blob,
	`encrypted_master_key_by_recovery_phrase` blob,
	`enhanced_encryption_salt` text,
	`master_key_version` integer DEFAULT 1 NOT NULL,
	`public_key` text,
	`encrypted_private_key` blob,
	`is_recovery_phrase_verified` integer DEFAULT false NOT NULL,
	`recovery_phrase_verified_at` integer,
	`user_encrypted_recovery_phrase_verification_data` blob,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_notification_preferences` (
	`user_id` text NOT NULL,
	`notification_type_id` text NOT NULL,
	`email_enabled` integer NOT NULL,
	`in_app_enabled` integer NOT NULL,
	`push_enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `notification_type_id`),
	FOREIGN KEY (`notification_type_id`) REFERENCES `notification_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_notification_prefs_user` ON `user_notification_preferences` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_permission_groups` (
	`user_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `group_id`),
	FOREIGN KEY (`group_id`) REFERENCES `permission_groups`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_permission_groups_user_id_unique` ON `user_permission_groups` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_permissions` (
	`user_id` text NOT NULL,
	`permission_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `permission_id`),
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`avatar_color` text DEFAULT '#000000',
	`theme_color` text DEFAULT 'Blue' NOT NULL,
	`dark_theme_color` text DEFAULT 'Blue' NOT NULL,
	`font_size` text DEFAULT 'Normal' NOT NULL,
	`is_dark_mode` text DEFAULT '#22262c',
	`language` text DEFAULT 'en' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_two_factor_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`encrypted_secret` blob NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_two_factor_secrets_user_id` ON `user_two_factor_secrets` (`user_id`);