CREATE TABLE `digest_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`job_ids` text NOT NULL,
	`to` text,
	`method` text,
	`error` text,
	`covered_until` integer NOT NULL,
	`sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `resume` ADD `change_log` text;--> statement-breakpoint
ALTER TABLE `resume` ADD `truth_warnings` text;