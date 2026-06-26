CREATE INDEX `threat_cidrs_active_id_idx` ON `threat_cidrs` (`is_active`,`id`);--> statement-breakpoint
CREATE INDEX `threat_ips_active_id_idx` ON `threat_ips` (`is_active`,`id`);