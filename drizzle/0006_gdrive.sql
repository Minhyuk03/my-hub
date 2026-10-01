ALTER TABLE `folders` ADD `external_id` text;--> statement-breakpoint
CREATE INDEX `folders_external` ON `folders` (`source_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `items` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `items` ADD `url` text;--> statement-breakpoint
CREATE INDEX `items_external` ON `items` (`source_id`,`external_id`);