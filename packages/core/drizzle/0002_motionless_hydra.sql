CREATE TABLE `answer_bank` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`question` text NOT NULL,
	`variants` text NOT NULL,
	`answer` text NOT NULL,
	`scope` text DEFAULT 'global' NOT NULL,
	`job_id` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `question_inbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`normalized` text NOT NULL,
	`question` text NOT NULL,
	`kind` text NOT NULL,
	`options` text NOT NULL,
	`category` text NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL,
	`first_job_id` integer,
	`last_job_id` integer,
	`suggested_answer` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`first_job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_inbox_norm_uq` ON `question_inbox` (`normalized`);