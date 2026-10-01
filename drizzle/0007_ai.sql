CREATE TABLE `ai_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`model` text NOT NULL,
	`text_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_suggestions_item_kind` ON `ai_suggestions` (`item_id`,`kind`);--> statement-breakpoint
CREATE INDEX `ai_suggestions_status` ON `ai_suggestions` (`status`,`kind`);--> statement-breakpoint
CREATE TABLE `item_embeddings` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`vector` blob NOT NULL,
	`text_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_tags_manual` (
	`item_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `item_tags_manual_tag` ON `item_tags_manual` (`tag_id`);