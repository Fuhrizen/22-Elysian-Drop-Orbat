CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` text NOT NULL,
	`slot` text NOT NULL,
	`event` text NOT NULL,
	`before_name` text DEFAULT '' NOT NULL,
	`after_name` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP INDEX `personnel_steam_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `personnel_steam_unique` ON `personnel` (`steam_id`) WHERE "personnel"."steam_id" <> '';