CREATE TABLE `idempotency_keys` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_user_id_created_at_idx` ON `idempotency_keys` (`user_id`,`created_at`);