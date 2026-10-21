CREATE TABLE `admin_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assignments` (
	`operation_id` text NOT NULL,
	`slot` text NOT NULL,
	`user_id` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`operation_id`, `slot`),
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `personnel`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_role_per_operation` ON `assignments` (`operation_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`briefing` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `personnel` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`steam_id` text NOT NULL,
	`discord_id` text DEFAULT '' NOT NULL,
	`steam_oauth_link` text DEFAULT '' NOT NULL,
	`discord_oauth_link` text DEFAULT '' NOT NULL,
	`rank` text DEFAULT 'Recruit' NOT NULL,
	`enlisted` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personnel_steam_unique` ON `personnel` (`steam_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
