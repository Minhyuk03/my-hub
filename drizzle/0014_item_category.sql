ALTER TABLE `items` ADD `category` text;--> statement-breakpoint
CREATE INDEX `items_category` ON `items` (`category`);