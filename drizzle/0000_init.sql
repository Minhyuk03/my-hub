CREATE TABLE `backups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	`size` integer NOT NULL,
	`verified_at` integer,
	`location` text NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
CREATE TABLE `commands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`taken_at` integer,
	`done_at` integer,
	`result` text
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`file_id` integer,
	`dev` integer,
	`state` text DEFAULT 'ok' NOT NULL,
	`seen_scan_id` integer,
	`modified_at` integer,
	`deleted_detected_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_path` ON `folders` (`path`);--> statement-breakpoint
CREATE INDEX `folders_inode` ON `folders` (`dev`,`file_id`);--> statement-breakpoint
CREATE TABLE `item_errors` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_links` (
	`item_id` integer NOT NULL,
	`target` text NOT NULL,
	PRIMARY KEY(`item_id`, `target`)
);
--> statement-breakpoint
CREATE TABLE `item_tags` (
	`item_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `item_tags_tag` ON `item_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `item_text` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`path` text NOT NULL,
	`body` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`folder_id` integer,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`ext` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_hash` text,
	`file_id` integer,
	`dev` integer,
	`state` text DEFAULT 'ok' NOT NULL,
	`no_content_reason` text,
	`created_at` integer,
	`modified_at` integer,
	`indexed_at` integer,
	`deleted_detected_at` integer,
	`seen_scan_id` integer,
	`preview_text` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_path` ON `items` (`path`);--> statement-breakpoint
CREATE INDEX `items_inode` ON `items` (`dev`,`file_id`);--> statement-breakpoint
CREATE INDEX `items_hash` ON `items` (`content_hash`);--> statement-breakpoint
CREATE INDEX `items_modified` ON `items` (`state`,`modified_at`);--> statement-breakpoint
CREATE INDEX `items_source` ON `items` (`source_id`,`state`);--> statement-breakpoint
CREATE INDEX `items_folder` ON `items` (`folder_id`);--> statement-breakpoint
CREATE TABLE `runtime` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`kind` text NOT NULL,
	`scope_path` text NOT NULL,
	`cursor` text,
	`processed` integer DEFAULT 0 NOT NULL,
	`total_estimate` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`result` text DEFAULT 'running' NOT NULL,
	`message` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_jobs_source` ON `scan_jobs` (`source_id`,`result`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`volume_root` text,
	`volume_uuid` text,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`last_full_scan_at` integer,
	`last_full_scan_ok` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_root_path_unique` ON `sources` (`root_path`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);