CREATE TABLE `personal_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_access_tokens_token_hash_uniq` ON `personal_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `personal_access_tokens_user_id_revoked_at_idx` ON `personal_access_tokens` (`user_id`,`revoked_at`);