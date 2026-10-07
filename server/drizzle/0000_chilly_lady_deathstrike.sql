CREATE TABLE `account` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_member_id` integer,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_type_check" CHECK("account"."type" IN ('bank', 'cash', 'investment', 'crypto', 'we_owe', 'owed_to_us')),
	CONSTRAINT "account_active_boolean_check" CHECK("account"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `backup` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`bytes` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`error` text,
	CONSTRAINT "backup_kind_check" CHECK("backup"."kind" IN ('daily', 'monthly', 'pre_migration')),
	CONSTRAINT "backup_status_check" CHECK("backup"."status" IN ('running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `checkin` (
	`id` integer PRIMARY KEY NOT NULL,
	`opened_at` integer NOT NULL,
	`opened_by` integer,
	`schedule_slot` text,
	`closed_at` integer,
	`closed_by` integer,
	FOREIGN KEY (`opened_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkin_one_open_unique` ON `checkin` (1) WHERE "checkin"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `checkin_schedule_slot_unique` ON `checkin` (`schedule_slot`);--> statement-breakpoint
CREATE TABLE `coin` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`decimals` integer NOT NULL,
	`feed_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "coin_decimals_check" CHECK("coin"."decimals" BETWEEN 0 AND 8),
	CONSTRAINT "coin_iso_code_check" CHECK("coin"."code" COLLATE NOCASE NOT IN ('AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOV', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHE', 'CHF', 'CHW', 'CLF', 'CLP', 'CNY', 'COP', 'COU', 'CRC', 'CUC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MXV', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SLL', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'USN', 'UYI', 'UYU', 'UYW', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XCG', 'XDR', 'XOF', 'XPD', 'XPF', 'XPT', 'XSU', 'XTS', 'XUA', 'XXX', 'YER', 'ZAR', 'ZMW', 'ZWG', 'ZWL'))
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`default_member_id` integer,
	`hide_home_amounts` integer DEFAULT true NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`default_member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_hide_home_amounts_boolean_check" CHECK("device"."hide_home_amounts" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `family` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`password_epoch` integer DEFAULT 0 NOT NULL,
	`common_currency` text DEFAULT 'EUR' NOT NULL,
	`time_zone` text DEFAULT 'Europe/Berlin' NOT NULL,
	`cadence_kind` text DEFAULT 'off' NOT NULL,
	`cadence_day_of_month` text,
	`cadence_every_weeks` integer,
	`cadence_weekday` integer,
	`cadence_time` text,
	`cadence_anchor_date` text,
	`followup_days` integer DEFAULT 2 NOT NULL,
	`failed_signins` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "family_singleton_id_check" CHECK("family"."id" = 1),
	CONSTRAINT "family_password_epoch_check" CHECK("family"."password_epoch" >= 0),
	CONSTRAINT "family_followup_days_check" CHECK("family"."followup_days" >= 0),
	CONSTRAINT "family_cadence_kind_check" CHECK("family"."cadence_kind" IN ('off', 'monthly', 'weeks')),
	CONSTRAINT "family_cadence_day_check" CHECK("family"."cadence_day_of_month" IS NULL OR "family"."cadence_day_of_month" = 'last' OR (length("family"."cadence_day_of_month") = 1 AND "family"."cadence_day_of_month" GLOB '[1-9]') OR (length("family"."cadence_day_of_month") = 2 AND "family"."cadence_day_of_month" GLOB '[0-9][0-9]' AND "family"."cadence_day_of_month" BETWEEN '10' AND '28')),
	CONSTRAINT "family_cadence_weeks_check" CHECK("family"."cadence_every_weeks" IS NULL OR "family"."cadence_every_weeks" BETWEEN 1 AND 8),
	CONSTRAINT "family_cadence_weekday_check" CHECK("family"."cadence_weekday" IS NULL OR "family"."cadence_weekday" BETWEEN 1 AND 7),
	CONSTRAINT "family_cadence_time_check" CHECK("family"."cadence_time" IS NULL OR ("family"."cadence_time" GLOB '[0-2][0-9]:[0-5][0-9]' AND substr("family"."cadence_time", 1, 2) <= '23'))
);
--> statement-breakpoint
CREATE TABLE `job_run` (
	`id` integer PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`slot` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text,
	CONSTRAINT "job_run_status_check" CHECK("job_run"."status" IN ('running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_run_job_slot_unique` ON `job_run` (`job`,`slot`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`deactivated_at` integer,
	CONSTRAINT "member_active_boolean_check" CHECK("member"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_active_name_unique` ON `member` (unicode_casefold("name")) WHERE "member"."active" = 1;--> statement-breakpoint
CREATE TABLE `notification` (
	`id` integer PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`checkin_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`slot` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`checkin_id`) REFERENCES `checkin`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_event_checkin_member_slot_unique` ON `notification` (`event`,`checkin_id`,`member_id`,`slot`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` integer PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credential_id_unique` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `push_subscription` (
	`id` integer PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`member_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_success_at` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_endpoint_unique` ON `push_subscription` (`endpoint`);--> statement-breakpoint
CREATE TABLE `rate` (
	`id` integer PRIMARY KEY NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`date` text NOT NULL,
	`rate` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_base_quote_date_unique` ON `rate` (`base`,`quote`,`date`);--> statement-breakpoint
CREATE TABLE `rate_fetch` (
	`id` integer PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`device_id` text NOT NULL,
	`member_id` integer,
	`password_epoch` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_device_idx` ON `session` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_hash_unique` ON `session` (`token_hash`);--> statement-breakpoint
CREATE TABLE `snapshot` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`taken_at` integer NOT NULL,
	`amount` integer NOT NULL,
	`source` text NOT NULL,
	`checkin_id` integer,
	`source_ref` text,
	`external_id` text,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkin_id`) REFERENCES `checkin`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "snapshot_source_check" CHECK("snapshot"."source" IN ('opening', 'manual', 'checkin', 'carried_forward', 'photo', 'statement', 'connector')),
	CONSTRAINT "snapshot_external_source_check" CHECK("snapshot"."external_id" IS NULL OR "snapshot"."source_ref" IS NOT NULL),
	CONSTRAINT "snapshot_carried_forward_check" CHECK("snapshot"."source" != 'carried_forward' OR "snapshot"."checkin_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_checkin_account_unique` ON `snapshot` (`checkin_id`,`account_id`) WHERE "snapshot"."checkin_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_source_external_unique` ON `snapshot` (`source_ref`,`external_id`) WHERE "snapshot"."source_ref" IS NOT NULL AND "snapshot"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `snapshot_account_taken_at_idx` ON `snapshot` (`account_id`,"taken_at" DESC);--> statement-breakpoint
CREATE TABLE `snapshot_revision` (
	`id` integer PRIMARY KEY NOT NULL,
	`snapshot_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`action` text NOT NULL,
	`old_amount` integer NOT NULL,
	`old_taken_at` integer NOT NULL,
	`changed_by` integer NOT NULL,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "snapshot_revision_action_check" CHECK("snapshot_revision"."action" IN ('update', 'delete'))
);
