import type Database from 'better-sqlite3';
import {
  activeMemberIds,
  hasEveryValue,
  memberName,
  membersWithAccountsLeft,
} from './recipients.js';
import { notificationText } from './text.js';
import type { NotificationEvent, NotificationPlan } from './types.js';

/**
 * Decides who is told about an event and what they read (CHK-2, CHK-4, CHK-9):
 * a scheduled check-in goes to every active member, one started by a member to
 * every other active member with their name, and a closed one to every active
 * member. A follow-up goes only to the active members who still own accounts
 * without a value in the open check-in (CHK-3); a schedule slot that finds a
 * check-in open sends the same reminder to the same members (CHK-2). Once
 * every account has a value, both go to every active member with the text
 * that asks to close it (owner's decision, 2026-10-13).
 */
export function planNotification(
  database: Database.Database,
  event: NotificationEvent,
): NotificationPlan {
  const everyone = activeMemberIds(database);
  switch (event.kind) {
    case 'checkin.opened': {
      const starter = memberName(database, event.openedBy);
      return {
        event: event.kind,
        checkinId: event.checkinId,
        slot: '',
        recipients: everyone.filter((id) => id !== event.openedBy),
        content:
          starter === null
            ? notificationText.scheduled(event.checkinId)
            : notificationText.startedBy(event.checkinId, starter),
      };
    }
    case 'checkin.followup': {
      const complete = hasEveryValue(database, event.checkinId);
      return {
        event: event.kind,
        checkinId: event.checkinId,
        slot: event.slot,
        recipients: complete
          ? everyone
          : membersWithAccountsLeft(database, event.checkinId),
        content: complete
          ? notificationText.closeReminder(event.checkinId)
          : notificationText.followUp(event.checkinId),
      };
    }
    case 'checkin.closed':
      return {
        event: event.kind,
        checkinId: event.checkinId,
        slot: '',
        recipients: everyone,
        content: notificationText.closed(
          event.checkinId,
          memberName(database, event.closedBy),
        ),
      };
  }
}
