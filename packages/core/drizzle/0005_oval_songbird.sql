CREATE TABLE `discovery_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prompt` text NOT NULL,
	`search_id` integer,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`candidates` text NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`search_id`) REFERENCES `saved_search`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `job` ADD `needs_detail` integer DEFAULT false NOT NULL;