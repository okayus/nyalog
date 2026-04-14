ALTER TABLE `cats` ADD `created_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `toilet_records` ADD `created_by` text REFERENCES users(id);