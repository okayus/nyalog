CREATE TABLE `medical_record_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`medical_record_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`original_filename` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`medical_record_id`) REFERENCES `medical_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `medical_record_attachments_medical_record_id_idx` ON `medical_record_attachments` (`medical_record_id`);--> statement-breakpoint
CREATE TABLE `medical_records` (
	`id` text PRIMARY KEY NOT NULL,
	`cat_id` text NOT NULL,
	`type` text NOT NULL,
	`recorded_at` text NOT NULL,
	`title` text,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `medical_records_cat_id_recorded_at_idx` ON `medical_records` (`cat_id`,`recorded_at`);