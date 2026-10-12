ALTER TABLE `device` ADD `lock_on_reopen` integer DEFAULT 1 NOT NULL CONSTRAINT "device_lock_on_reopen_boolean_check" CHECK ("lock_on_reopen" IN (0, 1));--> statement-breakpoint
ALTER TABLE `session` ADD `foreground_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `session` SET `foreground_at` = `last_used_at`;
