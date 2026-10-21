CREATE TABLE `operation_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`actor` text NOT NULL,
	`created` text NOT NULL,
	`snapshot` text NOT NULL
);
