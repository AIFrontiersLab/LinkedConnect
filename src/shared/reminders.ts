// Pure reminder logic used by the service worker: notification planning with persisted
// de-duplication, and the time of the next alarm.

import type { Contact } from "./types";
import { isFollowUpDue } from "./lifecycle";

/** Identifies one scheduled reminder; rescheduling produces a new key, so it can notify again. */
export function reminderKey(c: Pick<Contact, "id" | "nextFollowUpAt">): string {
  return `${c.id}|${c.nextFollowUpAt}`;
}

export const NOTIFICATION_PREFIX_CONTACT = "lmc-contact:";
export const NOTIFICATION_SUMMARY = "lmc-summary";

export interface PlannedNotification {
  id: string;
  title: string;
  message: string;
  /** Dashboard hash to open on click. */
  target: string;
}

export interface NotificationPlan {
  notification: PlannedNotification | null;
  /** The notified-key set to persist (pruned to reminders that are still due). */
  notifiedKeys: string[];
}

/**
 * Decides what to show for due follow-ups. Each reminder is announced at most once; several new
 * reminders are combined into one summary instead of one alert each.
 */
export function planNotifications(
  contacts: readonly Contact[],
  notifiedKeys: readonly string[],
  now: Date,
): NotificationPlan {
  const due = contacts.filter((c) => isFollowUpDue(c, now));
  const dueKeys = new Set(due.map(reminderKey));
  const already = new Set(notifiedKeys.filter((k) => dueKeys.has(k)));
  const fresh = due.filter((c) => !already.has(reminderKey(c)));
  const nextKeys = [...already, ...fresh.map(reminderKey)];

  if (fresh.length === 0) return { notification: null, notifiedKeys: nextKeys };
  if (fresh.length === 1) {
    const c = fresh[0]!;
    return {
      notifiedKeys: nextKeys,
      notification: {
        id: `${NOTIFICATION_PREFIX_CONTACT}${c.id}`,
        title: "Follow-up due",
        message: `Time to follow up with ${c.fullName}${c.company ? ` (${c.company})` : ""}.`,
        target: `#/contact/${encodeURIComponent(c.id)}`,
      },
    };
  }
  const names = fresh.slice(0, 3).map((c) => c.fullName);
  const more = fresh.length - names.length;
  return {
    notifiedKeys: nextKeys,
    notification: {
      id: NOTIFICATION_SUMMARY,
      title: `${fresh.length} follow-ups due`,
      message: `${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`,
      target: "#/followups",
    },
  };
}

/** Earliest future follow-up time, used for the one-shot chrome.alarms entry. */
export function nextReminderTime(contacts: readonly Contact[], now: Date): number | null {
  let best: number | null = null;
  for (const c of contacts) {
    if (c.archivedAt || !c.nextFollowUpAt) continue;
    const t = Date.parse(c.nextFollowUpAt);
    if (Number.isNaN(t) || t <= now.getTime()) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}

export function badgeText(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
