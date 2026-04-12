CREATE TABLE `toilet_records` (
	`id` text PRIMARY KEY NOT NULL,
	`cat_id` text NOT NULL,
	`type` text NOT NULL,
	`timestamp` text NOT NULL,
	`condition` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `toilet_records_cat_id_timestamp_idx` ON `toilet_records` (`cat_id`,`timestamp`);