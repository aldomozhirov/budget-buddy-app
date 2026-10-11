import type Database from 'better-sqlite3';
import { activeMemberIds, memberName } from './recipients.js';
import { notificationText } from './text.js';
import type { NotificationEvent, NotificationPlan } from './types.js';

/**
 * Decides who is told about an event and what they read (CHK-2, CHK-4, CHK-9):
 * a scheduled check-in goes to every active member, one started by a member to
 * every other active member with their name, and a closed one to every active
 * member.
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
