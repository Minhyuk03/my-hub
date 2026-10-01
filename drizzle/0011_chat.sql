CREATE TABLE `chat_citations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL,
	`n` integer NOT NULL,
	`item_id` integer NOT NULL,
	`chunk_id` integer,
	`title` text NOT NULL,
	`path` text NOT NULL,
	`quote` text NOT NULL,
	`cited` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_citations_message` ON `chat_citations` (`message_id`);--> statement-breakpoint
CREATE INDEX `chat_citations_item` ON `chat_citations` (`item_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`provider` text,
	`model` text,
	`local_only` integer DEFAULT false NOT NULL,
	`insufficient` integer DEFAULT false NOT NULL,
	`excluded_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_thread` ON `chat_messages` (`thread_id`,`id`);--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `external_deny` (
	`target_kind` text NOT NULL,
	`target_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`target_kind`, `target_id`)
);
--> statement-breakpoint
CREATE TABLE `external_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`thread_id` integer,
	`message_id` integer,
	`question` text NOT NULL,
	`item_ids` text NOT NULL,
	`chunk_ids` text NOT NULL,
	`history_count` integer DEFAULT 0 NOT NULL,
	`chars` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`status` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `external_log_time` ON `external_log` (`created_at`);