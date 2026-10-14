CREATE TABLE `category` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`default_envelope_id` integer,
	`position` integer NOT NULL,
	`archived_at` integer,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`updated_by` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`default_envelope_id`) REFERENCES `envelope`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "category_kind_check" CHECK("category"."kind" IN ('expense', 'income')),
	CONSTRAINT "category_default_envelope_check" CHECK("category"."default_envelope_id" IS NULL OR "category"."kind" = 'expense')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_kind_name_unique` ON `category` (`kind`,unicode_casefold("name"));--> statement-breakpoint
CREATE TABLE `envelope` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`starting_balance` integer NOT NULL,
	`starting_month` text NOT NULL,
	`topup_from_month` text NOT NULL,
	`default_category_id` integer,
	`position` integer NOT NULL,
	`archived_at` integer,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`default_category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "envelope_starting_month_check" CHECK("envelope"."starting_month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr("envelope"."starting_month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "envelope_topup_from_month_check" CHECK("envelope"."topup_from_month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr("envelope"."topup_from_month", 6, 2) BETWEEN '01' AND '12')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `envelope_name_unique` ON `envelope` (unicode_casefold("name"));--> statement-breakpoint
CREATE TABLE `envelope_adjustment` (
	`id` integer PRIMARY KEY NOT NULL,
	`envelope_id` integer NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`move_id` text,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`envelope_id`) REFERENCES `envelope`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "envelope_adjustment_amount_check" CHECK("envelope_adjustment"."amount" != 0),
	CONSTRAINT "envelope_adjustment_date_check" CHECK("envelope_adjustment"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND substr("envelope_adjustment"."date", 6, 2) BETWEEN '01' AND '12' AND substr("envelope_adjustment"."date", 9, 2) BETWEEN '01' AND '31')
);
--> statement-breakpoint
CREATE INDEX `envelope_adjustment_envelope_date_idx` ON `envelope_adjustment` (`envelope_id`,`date`);--> statement-breakpoint
CREATE INDEX `envelope_adjustment_move_idx` ON `envelope_adjustment` (`move_id`) WHERE "envelope_adjustment"."move_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `envelope_plan` (
	`id` integer PRIMARY KEY NOT NULL,
	`envelope_id` integer NOT NULL,
	`from_month` text NOT NULL,
	`monthly_amount` integer NOT NULL,
	`mode` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`envelope_id`) REFERENCES `envelope`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "envelope_plan_amount_check" CHECK("envelope_plan"."monthly_amount" >= 0),
	CONSTRAINT "envelope_plan_mode_check" CHECK("envelope_plan"."mode" IN ('carry_over', 'reset')),
	CONSTRAINT "envelope_plan_from_month_check" CHECK("envelope_plan"."from_month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr("envelope_plan"."from_month", 6, 2) BETWEEN '01' AND '12')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `envelope_plan_envelope_month_unique` ON `envelope_plan` (`envelope_id`,`from_month`);--> statement-breakpoint
CREATE TABLE `envelope_topup` (
	`id` integer PRIMARY KEY NOT NULL,
	`envelope_id` integer NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`mode` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`envelope_id`) REFERENCES `envelope`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "envelope_topup_mode_check" CHECK("envelope_topup"."mode" IN ('carry_over', 'reset')),
	CONSTRAINT "envelope_topup_month_check" CHECK("envelope_topup"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr("envelope_topup"."month", 6, 2) BETWEEN '01' AND '12')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `envelope_topup_envelope_month_unique` ON `envelope_topup` (`envelope_id`,`month`);--> statement-breakpoint
CREATE TABLE `rule` (
	`id` integer PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`pattern` text NOT NULL,
	`category_id` integer NOT NULL,
	`envelope_id` integer,
	`account_id` integer,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`envelope_id`) REFERENCES `envelope`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rule_pattern_check" CHECK(length(trim("rule"."pattern")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_position_unique` ON `rule` (`position`);--> statement-breakpoint
CREATE TABLE `txn` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text,
	`client_hash` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`date` text NOT NULL,
	`account_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`to_account_id` integer,
	`to_amount` integer,
	`member_id` integer NOT NULL,
	`merchant` text,
	`merchant_key` text,
	`note` text,
	`source` text DEFAULT 'typed' NOT NULL,
	`source_ref` text,
	`external_id` text,
	`entered_at` integer,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "txn_kind_check" CHECK("txn"."kind" IN ('expense', 'income', 'transfer')),
	CONSTRAINT "txn_status_check" CHECK("txn"."status" IN ('draft', 'confirmed')),
	CONSTRAINT "txn_source_check" CHECK("txn"."source" IN ('typed', 'photo', 'apple_pay', 'statement', 'connector')),
	CONSTRAINT "txn_date_check" CHECK("txn"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND substr("txn"."date", 6, 2) BETWEEN '01' AND '12' AND substr("txn"."date", 9, 2) BETWEEN '01' AND '31'),
	CONSTRAINT "txn_expense_amount_check" CHECK("txn"."kind" != 'expense' OR "txn"."amount" != 0),
	CONSTRAINT "txn_income_amount_check" CHECK("txn"."kind" != 'income' OR "txn"."amount" > 0),
	CONSTRAINT "txn_transfer_check" CHECK("txn"."kind" != 'transfer' OR ("txn"."amount" > 0 AND "txn"."to_amount" IS NOT NULL AND "txn"."to_amount" > 0 AND "txn"."to_account_id" IS NOT NULL AND "txn"."to_account_id" != "txn"."account_id" AND "txn"."merchant" IS NULL)),
	CONSTRAINT "txn_no_transfer_side_check" CHECK("txn"."kind" = 'transfer' OR ("txn"."to_account_id" IS NULL AND "txn"."to_amount" IS NULL)),
	CONSTRAINT "txn_external_source_check" CHECK("txn"."external_id" IS NULL OR "txn"."source_ref" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `txn_client_id_unique` ON `txn` (`client_id`) WHERE "txn"."client_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `txn_source_external_unique` ON `txn` (`source_ref`,`external_id`) WHERE "txn"."source_ref" IS NOT NULL AND "txn"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `txn_date_idx` ON `txn` ("date" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX `txn_account_date_idx` ON `txn` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `txn_to_account_date_idx` ON `txn` (`to_account_id`,`date`) WHERE "txn"."to_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `txn_member_date_idx` ON `txn` (`member_id`,`date`);--> statement-breakpoint
CREATE INDEX `txn_merchant_key_idx` ON `txn` (`merchant_key`) WHERE "txn"."merchant_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `txn_part` (
	`id` integer PRIMARY KEY NOT NULL,
	`txn_id` integer NOT NULL,
	`position` integer NOT NULL,
	`amount` integer NOT NULL,
	`category_id` integer,
	`envelope_id` integer,
	`envelope_amount` integer,
	`envelope_amount_manual` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`txn_id`) REFERENCES `txn`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`envelope_id`) REFERENCES `envelope`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "txn_part_manual_boolean_check" CHECK("txn_part"."envelope_amount_manual" IN (0, 1)),
	CONSTRAINT "txn_part_envelope_amount_check" CHECK("txn_part"."envelope_amount" IS NULL OR "txn_part"."envelope_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `txn_part_envelope_idx` ON `txn_part` (`envelope_id`) WHERE "txn_part"."envelope_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `txn_part_category_idx` ON `txn_part` (`category_id`);--> statement-breakpoint
CREATE INDEX `txn_part_uncategorised_idx` ON `txn_part` (`txn_id`) WHERE "txn_part"."category_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `txn_part_txn_position_unique` ON `txn_part` (`txn_id`,`position`);--> statement-breakpoint
CREATE TABLE `txn_revision` (
	`id` integer PRIMARY KEY NOT NULL,
	`txn_id` integer NOT NULL,
	`action` text NOT NULL,
	`changes` text NOT NULL,
	`changed_by` integer NOT NULL,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`changed_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "txn_revision_action_check" CHECK("txn_revision"."action" IN ('update', 'delete')),
	CONSTRAINT "txn_revision_changes_check" CHECK(json_valid("txn_revision"."changes"))
);
--> statement-breakpoint
CREATE INDEX `txn_revision_txn_idx` ON `txn_revision` (`txn_id`);
--> statement-breakpoint
-- Starter categories (CAT-3, O1) for a family that already did first start.
-- A fresh install has no family yet and gets them at first start.
INSERT INTO `category` (`name`, `kind`, `position`, `created_at`, `updated_at`)
SELECT `column1`, `column2`, `column3`, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (VALUES
  ('Groceries', 'expense', 1),
  ('Eating out', 'expense', 2),
  ('Housing', 'expense', 3),
  ('Utilities', 'expense', 4),
  ('Transport', 'expense', 5),
  ('Health', 'expense', 6),
  ('Insurance', 'expense', 7),
  ('Subscriptions', 'expense', 8),
  ('Shopping', 'expense', 9),
  ('Travel', 'expense', 10),
  ('Leisure', 'expense', 11),
  ('Gifts', 'expense', 12),
  ('Fees and taxes', 'expense', 13),
  ('Other', 'expense', 14),
  ('Salary', 'income', 15),
  ('Other income', 'income', 16)
)
WHERE EXISTS (SELECT 1 FROM `family`);
