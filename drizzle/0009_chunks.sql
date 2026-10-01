CREATE TABLE `item_chunk_state` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`text_hash` text NOT NULL,
	`chunks` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `item_chunks_item` ON `item_chunks` (`item_id`,`idx`);