CREATE TABLE `extension_pairing` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`last_seen_at` integer,
	`version` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extension_pairing_token_unique` ON `extension_pairing` (`token`);--> statement-breakpoint
CREATE TABLE `invite` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`role` text DEFAULT 'member' NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_hash_unique` ON `invite` (`token_hash`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`onboarding_step` text DEFAULT 'search',
	`last_search_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_setting` (
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_setting_uq` ON `user_setting` (`user_id`,`key`);--> statement-breakpoint
DROP INDEX `application_job_id_unique`;--> statement-breakpoint
ALTER TABLE `application` ADD `user_id` integer REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `application` ADD `search_id` integer REFERENCES saved_search(id);--> statement-breakpoint
CREATE UNIQUE INDEX `application_user_job_uq` ON `application` (`user_id`,`job_id`);--> statement-breakpoint
DROP INDEX `question_inbox_norm_uq`;--> statement-breakpoint
ALTER TABLE `question_inbox` ADD `user_id` integer REFERENCES user(id);--> statement-breakpoint
CREATE UNIQUE INDEX `question_inbox_user_norm_uq` ON `question_inbox` (`user_id`,`normalized`);--> statement-breakpoint
ALTER TABLE `answer_bank` ADD `user_id` integer REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `digest_run` ADD `user_id` integer REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `discovery_run` ADD `started_by` integer REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `llm_usage` ADD `user_id` integer REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `profile` ADD `user_id` integer REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `profile` ADD `about` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `writing_sample` text;--> statement-breakpoint
CREATE UNIQUE INDEX `profile_user_id_unique` ON `profile` (`user_id`);--> statement-breakpoint
ALTER TABLE `resume` ADD `user_id` integer REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `saved_search` ADD `user_id` integer REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `saved_search` ADD `name` text;--> statement-breakpoint
ALTER TABLE `saved_search` ADD `digest_min_fit` integer;--> statement-breakpoint
ALTER TABLE `saved_search` ADD `last_viewed_at` integer;--> statement-breakpoint
ALTER TABLE `saved_search` ADD `archived_at` integer;