CREATE TABLE `cron_job_executions` (
	`job_name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL,
	`last_status` text,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cron_job_executions_last_run_at_idx` ON `cron_job_executions` (`last_run_at`);--> statement-breakpoint
CREATE TABLE `durable_cache` (
	`namespace` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`namespace`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idx_durable_cache_expires_at` ON `durable_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text,
	`user_id` text NOT NULL,
	`to` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`type` text NOT NULL,
	`email_template` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_event` text DEFAULT 'email.sent',
	`data` text,
	`email_language` text DEFAULT 'en' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `environment_backup_purge_queue` (
	`environment_id` text PRIMARY KEY NOT NULL,
	`prefix` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`delete_after` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_environment_backup_purge_queue_delete_after` ON `environment_backup_purge_queue` (`delete_after`);--> statement-breakpoint
CREATE TABLE `environment_quotas` (
	`id` text PRIMARY KEY NOT NULL,
	`max_users` integer,
	`max_storage_kb` integer,
	`max_file_size_kb` integer,
	`current_storage_kb` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `environment_sqlite_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`db_url_encrypted` blob NOT NULL,
	`db_token_encrypted` blob,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`custom_subdomain` text,
	`custom_domain` text,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`default_language` text DEFAULT 'en' NOT NULL,
	`internal_notes` text,
	`feature_documents` integer DEFAULT true NOT NULL,
	`feature_encryption` integer DEFAULT true NOT NULL,
	`feature_public_sharing` integer DEFAULT true NOT NULL,
	`feature_notes` integer DEFAULT true NOT NULL,
	`feature_knowledge_base` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_environments_custom_domain` ON `environments` (`custom_domain`);--> statement-breakpoint
CREATE INDEX `idx_environments_custom_subdomain` ON `environments` (`custom_subdomain`);--> statement-breakpoint
CREATE TABLE `job_locks` (
	`job_name` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_job_locks_expires_at` ON `job_locks` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_job_locks_instance_id` ON `job_locks` (`instance_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_error` text,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status_updated` ON `jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_type_status` ON `jobs` (`type`,`status`);--> statement-breakpoint
CREATE TABLE `passkey_prf_keys` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`encrypted_master_key` blob NOT NULL,
	`prf_salt` text NOT NULL,
	`master_key_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `user_passkeys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`ip_address` text NOT NULL,
	`max_age_type` integer NOT NULL,
	`encrypted_password_derived_key` text,
	`encrypted_prf_derived_key` text,
	`prf_credential_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_user_id` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_expires_at` ON `refresh_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `threat_cidrs` (
	`id` text PRIMARY KEY NOT NULL,
	`cidr_block` text NOT NULL,
	`source_id` text NOT NULL,
	`risk_score` integer DEFAULT 50,
	`category` text DEFAULT 'malicious',
	`metadata` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `threat_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threat_cidrs_cidr_idx` ON `threat_cidrs` (`cidr_block`);--> statement-breakpoint
CREATE INDEX `threat_cidrs_source_idx` ON `threat_cidrs` (`source_id`);--> statement-breakpoint
CREATE INDEX `threat_cidrs_active_idx` ON `threat_cidrs` (`is_active`);--> statement-breakpoint
CREATE INDEX `threat_cidrs_category_idx` ON `threat_cidrs` (`category`);--> statement-breakpoint
CREATE INDEX `threat_cidrs_cidr_active_idx` ON `threat_cidrs` (`cidr_block`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `threat_cidrs_unique_cidr_source` ON `threat_cidrs` (`cidr_block`,`source_id`);--> statement-breakpoint
CREATE TABLE `threat_ips` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_address` text NOT NULL,
	`source_id` text NOT NULL,
	`risk_score` integer DEFAULT 50,
	`category` text DEFAULT 'malicious',
	`metadata` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `threat_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threat_ips_ip_idx` ON `threat_ips` (`ip_address`);--> statement-breakpoint
CREATE INDEX `threat_ips_source_idx` ON `threat_ips` (`source_id`);--> statement-breakpoint
CREATE INDEX `threat_ips_active_idx` ON `threat_ips` (`is_active`);--> statement-breakpoint
CREATE INDEX `threat_ips_category_idx` ON `threat_ips` (`category`);--> statement-breakpoint
CREATE INDEX `threat_ips_risk_score_idx` ON `threat_ips` (`risk_score`);--> statement-breakpoint
CREATE INDEX `threat_ips_ip_active_idx` ON `threat_ips` (`ip_address`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `threat_ips_unique_ip_source` ON `threat_ips` (`ip_address`,`source_id`);--> statement-breakpoint
CREATE TABLE `threat_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`update_frequency_hours` integer DEFAULT 24,
	`total_entries` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threat_sources_name_unique` ON `threat_sources` (`name`);--> statement-breakpoint
CREATE INDEX `threat_sources_name_idx` ON `threat_sources` (`name`);--> statement-breakpoint
CREATE INDEX `threat_sources_active_idx` ON `threat_sources` (`is_active`);--> statement-breakpoint
CREATE TABLE `threat_update_log` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`update_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`entries_added` integer DEFAULT 0,
	`entries_updated` integer DEFAULT 0,
	`entries_removed` integer DEFAULT 0,
	`error_message` text,
	`duration_ms` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `threat_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threat_update_log_source_idx` ON `threat_update_log` (`source_id`);--> statement-breakpoint
CREATE INDEX `threat_update_log_status_idx` ON `threat_update_log` (`status`);--> statement-breakpoint
CREATE INDEX `threat_update_log_type_idx` ON `threat_update_log` (`update_type`);--> statement-breakpoint
CREATE TABLE `trace_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`user_id` text,
	`correlation_id` text,
	`request_id` text,
	`session_id` text,
	`ip_address` text,
	`user_agent` text,
	`error_count` integer DEFAULT 1 NOT NULL,
	`error_message` text,
	`duration` integer NOT NULL,
	`span_count` integer NOT NULL,
	`breadcrumb_count` integer NOT NULL,
	`trace_data` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trace_logs_trace_id_unique` ON `trace_logs` (`trace_id`);--> statement-breakpoint
CREATE INDEX `trace_logs_instance_id_idx` ON `trace_logs` (`instance_id`);--> statement-breakpoint
CREATE INDEX `trace_logs_user_id_idx` ON `trace_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `trace_logs_correlation_id_idx` ON `trace_logs` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `trace_logs_created_at_idx` ON `trace_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `trace_logs_expires_at_idx` ON `trace_logs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text NOT NULL,
	`display_name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_passkeys_user_id` ON `user_passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_password_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_password_history_user_id` ON `user_password_history` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password` text,
	`username` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`environment_id` text NOT NULL,
	`is_banned` integer DEFAULT false NOT NULL,
	`email_allowed` integer DEFAULT true NOT NULL,
	`is_two_factor_enabled` integer DEFAULT false NOT NULL,
	`is_active` integer NOT NULL,
	`is_super_admin` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_environment_id` ON `users` (`environment_id`);--> statement-breakpoint
CREATE TABLE `whitelisted_cidrs` (
	`id` text PRIMARY KEY NOT NULL,
	`cidr_block` text NOT NULL,
	`reason` text,
	`added_by` text,
	`is_active` integer DEFAULT true NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `whitelisted_cidrs_cidr_idx` ON `whitelisted_cidrs` (`cidr_block`);--> statement-breakpoint
CREATE INDEX `whitelisted_cidrs_active_idx` ON `whitelisted_cidrs` (`is_active`);--> statement-breakpoint
CREATE INDEX `whitelisted_cidrs_cidr_active_idx` ON `whitelisted_cidrs` (`cidr_block`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `whitelisted_cidrs_unique_active_cidr` ON `whitelisted_cidrs` (`cidr_block`,`is_active`);--> statement-breakpoint
CREATE TABLE `whitelisted_ips` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_address` text NOT NULL,
	`reason` text,
	`added_by` text,
	`is_active` integer DEFAULT true NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `whitelisted_ips_ip_idx` ON `whitelisted_ips` (`ip_address`);--> statement-breakpoint
CREATE INDEX `whitelisted_ips_active_idx` ON `whitelisted_ips` (`is_active`);--> statement-breakpoint
CREATE INDEX `whitelisted_ips_ip_active_idx` ON `whitelisted_ips` (`ip_address`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `whitelisted_ips_unique_active_ip` ON `whitelisted_ips` (`ip_address`,`is_active`);