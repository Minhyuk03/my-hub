CREATE TABLE `para_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`item_id` integer,
	`folder_id` integer,
	`from_path` text NOT NULL,
	`to_path` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `para_moves_paths` ON `para_moves` (`from_path`,`to_path`);--> statement-breakpoint
CREATE INDEX `para_moves_status` ON `para_moves` (`status`);