ALTER TABLE `cats` ADD `birthday` text;--> statement-breakpoint
ALTER TABLE `cats` ADD `updated_at` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `cats` SET `updated_at` = `created_at` WHERE `updated_at` = '';