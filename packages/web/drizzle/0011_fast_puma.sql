CREATE TABLE `cat_task_cats` (
	`task_id` text NOT NULL,
	`cat_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `cat_id`),
	FOREIGN KEY (`task_id`) REFERENCES `cat_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cat_task_cats_cat_id_idx` ON `cat_task_cats` (`cat_id`);--> statement-breakpoint
CREATE TABLE `cat_task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`cat_id` text NOT NULL,
	`due_date` text NOT NULL,
	`completed_at` text NOT NULL,
	`completed_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `cat_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_task_completions_task_cat_due_uniq` ON `cat_task_completions` (`task_id`,`cat_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `cat_task_completions_task_due_idx` ON `cat_task_completions` (`task_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `cat_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`title` text NOT NULL,
	`recurrence_type` text NOT NULL,
	`recurrence_value` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cat_tasks_space_id_idx` ON `cat_tasks` (`space_id`);