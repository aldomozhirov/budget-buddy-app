PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_snapshot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
	CONSTRAINT "snapshot_source_check" CHECK("__new_snapshot"."source" IN ('opening', 'manual', 'checkin', 'carried_forward', 'photo', 'statement', 'connector')),
	CONSTRAINT "snapshot_external_source_check" CHECK("__new_snapshot"."external_id" IS NULL OR "__new_snapshot"."source_ref" IS NOT NULL),
	CONSTRAINT "snapshot_carried_forward_check" CHECK("__new_snapshot"."source" != 'carried_forward' OR "__new_snapshot"."checkin_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_snapshot`("id", "account_id", "taken_at", "amount", "source", "checkin_id", "source_ref", "external_id", "created_by", "created_at", "updated_by", "updated_at") SELECT "id", "account_id", "taken_at", "amount", "source", "checkin_id", "source_ref", "external_id", "created_by", "created_at", "updated_by", "updated_at" FROM `snapshot`;--> statement-breakpoint
DROP TABLE `snapshot`;--> statement-breakpoint
ALTER TABLE `__new_snapshot` RENAME TO `snapshot`;--> statement-breakpoint
DELETE FROM sqlite_sequence WHERE name = 'snapshot';--> statement-breakpoint
INSERT INTO sqlite_sequence(name, seq)
VALUES (
  'snapshot',
  MAX(
    COALESCE((SELECT MAX(id) FROM `snapshot`), 0),
    COALESCE((SELECT MAX(snapshot_id) FROM `snapshot_revision`), 0)
  )
);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_checkin_account_unique` ON `snapshot` (`checkin_id`,`account_id`) WHERE "snapshot"."checkin_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_source_external_unique` ON `snapshot` (`source_ref`,`external_id`) WHERE "snapshot"."source_ref" IS NOT NULL AND "snapshot"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `snapshot_account_taken_at_idx` ON `snapshot` (`account_id`, "taken_at" DESC);
