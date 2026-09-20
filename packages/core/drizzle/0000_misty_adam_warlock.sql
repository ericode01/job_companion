CREATE TABLE `company` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`ats_type` text NOT NULL,
	`ats_slug` text NOT NULL,
	`source` text NOT NULL,
	`watch` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_crawled_at` integer,
	`crawl_status` text,
	`crawl_error` text,
	`open_job_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_ats_uq` ON `company` (`ats_type`,`ats_slug`);--> statement-breakpoint
CREATE TABLE `crawl_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`jobs_upserted` integer DEFAULT 0 NOT NULL,
	`jobs_closed` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`ats_type` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`apply_url` text NOT NULL,
	`title` text NOT NULL,
	`title_normalized` text NOT NULL,
	`department` text,
	`locations` text NOT NULL,
	`location_type` text NOT NULL,
	`remote_countries` text NOT NULL,
	`comp` text,
	`description_html` text NOT NULL,
	`description_text` text NOT NULL,
	`posted_at` integer,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closed_at` integer,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_ext_uq` ON `job` (`ats_type`,`company_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `job_open_idx` ON `job` (`closed_at`,`posted_at`);--> statement-breakpoint
CREATE TABLE `job_match` (
	`job_id` integer NOT NULL,
	`search_id` integer NOT NULL,
	`rule_pass` integer NOT NULL,
	`fit_score` real,
	`fit_reasons` text,
	`matched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`search_id`) REFERENCES `saved_search`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_match_uq` ON `job_match` (`job_id`,`search_id`);--> statement-breakpoint
CREATE TABLE `llm_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`phone` text,
	`location` text,
	`links` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_search` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`raw_query` text NOT NULL,
	`filter` text NOT NULL,
	`parsed_by` text NOT NULL,
	`notify` integer DEFAULT false NOT NULL,
	`last_run_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
