CREATE TABLE `blood_test_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`attachment_id` text NOT NULL,
	`status` text NOT NULL,
	`model_name` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`error_message` text,
	`raw_response` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `medical_record_attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blood_test_analyses_attachment_id_unique` ON `blood_test_analyses` (`attachment_id`);--> statement-breakpoint
CREATE INDEX `blood_test_analyses_attachment_id_idx` ON `blood_test_analyses` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `blood_test_values` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`item_code` text NOT NULL,
	`item_label` text NOT NULL,
	`unit` text,
	`value_text` text NOT NULL,
	`value_numeric` real,
	`ref_low` real,
	`ref_high` real,
	`ref_text` text,
	`flag` text NOT NULL,
	`notes` text,
	`row_index` integer NOT NULL,
	`reviewed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`analysis_id`) REFERENCES `blood_test_analyses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blood_test_values_analysis_id_idx` ON `blood_test_values` (`analysis_id`);