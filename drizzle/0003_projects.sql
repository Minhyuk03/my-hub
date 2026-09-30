CREATE TABLE `project_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`folder_id` integer NOT NULL,
	`include_subfolders` integer DEFAULT true NOT NULL,
	`added_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_folders_uniq` ON `project_folders` (`project_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `project_folders_folder` ON `project_folders` (`folder_id`);--> statement-breakpoint
CREATE TABLE `project_items` (
	`project_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`mode` text NOT NULL,
	`added_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `item_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_items_item` ON `project_items` (`item_id`);--> statement-breakpoint
CREATE TABLE `project_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`project_id` integer,
	`folder_ids` text NOT NULL,
	`suggested_name` text NOT NULL,
	`reason` text NOT NULL,
	`score` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_suggestions_key_unique` ON `project_suggestions` (`key`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`external_policy` text DEFAULT 'allow' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
