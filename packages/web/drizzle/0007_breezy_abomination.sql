PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cats` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`birthday` text,
	`theme_color` text DEFAULT 'gray' NOT NULL,
	`space_id` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_cats`("id", "name", "birthday", "theme_color", "space_id", "created_by", "created_at", "updated_at") SELECT "id", "name", "birthday", "theme_color", "space_id", "created_by", "created_at", "updated_at" FROM `cats`;--> statement-breakpoint
DROP TABLE `cats`;--> statement-breakpoint
ALTER TABLE `__new_cats` RENAME TO `cats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cats_space_id_idx` ON `cats` (`space_id`);