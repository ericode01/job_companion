CREATE TABLE `application_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`source` text NOT NULL,
	`email_id` integer,
	`reverted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`email_id`) REFERENCES `email_message`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `application_event_app_idx` ON `application_event` (`application_id`);--> statement-breakpoint
CREATE TABLE `email_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`connection_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`rfc_message_id` text,
	`thread_id` text,
	`web_link` text,
	`from_name` text,
	`from_address` text,
	`subject` text,
	`received_at` integer NOT NULL,
	`snippet` text,
	`kind` text NOT NULL,
	`round` text,
	`round_label` text,
	`event_at` integer,
	`company_name` text,
	`job_title` text,
	`summary` text,
	`confidence` real,
	`classified_by` text,
	`application_id` integer,
	`action_needed` integer DEFAULT false NOT NULL,
	`action_type` text,
	`action_text` text,
	`action_due_at` integer,
	`action_done_at` integer,
	`review_state` text DEFAULT 'auto' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `mailbox_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_conn_provider_uq` ON `email_message` (`connection_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `email_user_app_idx` ON `email_message` (`user_id`,`application_id`);--> statement-breakpoint
CREATE INDEX `email_thread_idx` ON `email_message` (`user_id`,`thread_id`);--> statement-breakpoint
CREATE TABLE `mailbox_connection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`address` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`secret` text NOT NULL,
	`imap_host` text,
	`imap_port` integer,
	`cursor` text DEFAULT '{}' NOT NULL,
	`backfill_days` integer DEFAULT 90 NOT NULL,
	`backfill_done` integer DEFAULT false NOT NULL,
	`progress` text,
	`last_sync_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_user_address_uq` ON `mailbox_connection` (`user_id`,`address`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`search_id` integer,
	`job_id` integer,
	`company_name` text,
	`job_title` text,
	`job_url` text,
	`source` text DEFAULT 'app' NOT NULL,
	`confirmed_at` integer,
	`status` text NOT NULL,
	`notes` text,
	`resume_id` integer,
	`cover_letter_choice` text,
	`cover_letter` text,
	`cover_letter_warnings` text,
	`answers` text,
	`applied_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`search_id`) REFERENCES `saved_search`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resume`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_application`("id", "user_id", "search_id", "job_id", "status", "notes", "resume_id", "cover_letter_choice", "cover_letter", "cover_letter_warnings", "answers", "applied_at", "created_at", "updated_at") SELECT "id", "user_id", "search_id", "job_id", "status", "notes", "resume_id", "cover_letter_choice", "cover_letter", "cover_letter_warnings", "answers", "applied_at", "created_at", "updated_at" FROM `application`;--> statement-breakpoint
DROP TABLE `application`;--> statement-breakpoint
ALTER TABLE `__new_application` RENAME TO `application`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `application_user_job_uq` ON `application` (`user_id`,`job_id`);