CREATE TABLE `plan_link` (
	`id` integer PRIMARY KEY NOT NULL,
	`txn_id` integer NOT NULL,
	`kind` text NOT NULL,
	`wish_id` integer,
	`month` text NOT NULL,
	`amount` integer,
	`amount_manual` integer DEFAULT false NOT NULL,
	`made_how` text NOT NULL,
	`made_by` integer,
	`made_at` integer NOT NULL,
	`detached_at` integer,
	`detached_reason` text,
	FOREIGN KEY (`txn_id`) REFERENCES `txn`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wish_id`) REFERENCES `wish`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`made_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_link_kind_check" CHECK("plan_link"."kind" IN ('wish')),
	CONSTRAINT "plan_link_made_how_check" CHECK("plan_link"."made_how" IN ('recorded', 'member')),
	CONSTRAINT "plan_link_detached_reason_check" CHECK("plan_link"."detached_reason" IS NULL OR "plan_link"."detached_reason" IN ('wish_deleted')),
	CONSTRAINT "plan_link_wish_check" CHECK("plan_link"."kind" <> 'wish' OR "plan_link"."wish_id" IS NOT NULL),
	CONSTRAINT "plan_link_manual_check" CHECK("plan_link"."amount_manual" IN (0, 1) AND ("plan_link"."amount_manual" = 0 OR "plan_link"."amount" IS NOT NULL)),
	CONSTRAINT "plan_link_month_check" CHECK("plan_link"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr("plan_link"."month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "plan_link_detached_check" CHECK(("plan_link"."detached_at" IS NULL) = ("plan_link"."detached_reason" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_link_txn_active_unique` ON `plan_link` (`txn_id`) WHERE "plan_link"."detached_at" IS NULL;--> statement-breakpoint
CREATE INDEX `plan_link_wish_idx` ON `plan_link` (`wish_id`) WHERE "plan_link"."detached_at" IS NULL;--> statement-breakpoint
CREATE INDEX `plan_link_month_idx` ON `plan_link` (`month`) WHERE "plan_link"."detached_at" IS NULL;--> statement-breakpoint
CREATE TABLE `wish` (
	`id` integer PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`expression` text,
	`currency` text NOT NULL,
	`category_id` integer,
	`note` text,
	`state` text DEFAULT 'open' NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` integer,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wish_month_check" CHECK("wish"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr("wish"."month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "wish_amount_check" CHECK("wish"."amount" > 0),
	CONSTRAINT "wish_state_check" CHECK("wish"."state" IN ('open', 'done', 'dropped')),
	CONSTRAINT "wish_deleted_check" CHECK(("wish"."deleted_at" IS NULL) = ("wish"."deleted_by" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `wish_month_idx` ON `wish` (`month`) WHERE "wish"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `wish_category_idx` ON `wish` (`category_id`) WHERE "wish"."category_id" IS NOT NULL;