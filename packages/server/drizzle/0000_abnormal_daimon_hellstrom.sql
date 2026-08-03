CREATE TABLE `alert_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`delivery_methods` text DEFAULT '[]' NOT NULL,
	`available_delivery_methods` text DEFAULT '[]' NOT NULL,
	`repeat_suppression_minutes` integer DEFAULT 10 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cooker_probe_assignments` (
	`cooker_id` integer NOT NULL,
	`device_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`cooker_id`, `device_id`),
	FOREIGN KEY (`cooker_id`) REFERENCES `cookers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cookers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cookers_name_unique` ON `cookers` (`name`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`target_temp` integer,
	`alarm_low` integer,
	`alarm_high` integer,
	`alarm_type` text,
	`current_temp` real,
	`fan_on` integer,
	`total_runtime` integer,
	`blower_device_id` text
);
--> statement-breakpoint
CREATE TABLE `log_blower_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`log_id` text NOT NULL,
	`device_id` text NOT NULL,
	`collected_at` text NOT NULL,
	`fan_on` integer NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `log_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `log_device_roster` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`log_id` text NOT NULL,
	`device_id` text NOT NULL,
	`device_name` text NOT NULL,
	`device_type` text NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `log_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `log_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`log_id` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `log_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `log_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`log_id` text NOT NULL,
	`device_id` text NOT NULL,
	`collected_at` text NOT NULL,
	`temp_f` real NOT NULL,
	`temp_c` real NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `log_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `log_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`cooker_name` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE TABLE `log_weather_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`log_id` text NOT NULL,
	`collected_at` text NOT NULL,
	`temp_f` real NOT NULL,
	`condition_text` text NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `log_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);