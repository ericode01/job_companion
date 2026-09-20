CREATE TABLE `application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`resume_id` integer,
	`cover_letter_choice` text,
	`cover_letter` text,
	`answers` text,
	`applied_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resume`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_job_id_unique` ON `application` (`job_id`);--> statement-breakpoint
CREATE TABLE `company_profile` (
	`company_id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`consulted_urls` text NOT NULL,
	`model` text NOT NULL,
	`enriched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_analysis` (
	`job_id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`content_hash` text NOT NULL,
	`model` text NOT NULL,
	`analyzed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_fit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`resume_hash` text NOT NULL,
	`score` integer NOT NULL,
	`data` text NOT NULL,
	`model` text NOT NULL,
	`scored_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_fit_uq` ON `job_fit` (`job_id`,`resume_hash`);--> statement-breakpoint
CREATE TABLE `resume` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`base_resume_id` integer,
	`job_id` integer,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`parsed_text` text NOT NULL,
	`source` text,
	`source_hash` text NOT NULL,
	`parse_status` text NOT NULL,
	`parse_error` text,
	`status` text DEFAULT 'approved' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`background` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `task_claim_idx` ON `task` (`status`,`kind`,`priority`);--> statement-breakpoint
CREATE INDEX `task_key_idx` ON `task` (`kind`,`key`);--> statement-breakpoint
ALTER TABLE `job_match` DROP COLUMN `fit_score`;--> statement-breakpoint
ALTER TABLE `job_match` DROP COLUMN `fit_reasons`;