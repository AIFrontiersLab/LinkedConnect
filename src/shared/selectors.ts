// Read-only views over contacts: summary counts, tab filters, search and sorting.

import type { Category, Contact, LifecycleStatus } from "./types";
import { isFollowUpDue, isNewSinceReview, isReadyForInitialMessage, countActionable } from "./lifecycle";

export interface Summary {
  pending: number;
  readyToMessage: number;
  followUpsDue: number;
  replied: number;
  active: number;
  actionable: number;
  newSinceReview: number;
}

export function summarize(contacts: readonly Contact[], now: Date): Summary {
  const active = contacts.filter((c) => !c.archivedAt);
  return {
    pending: active.filter((c) => c.lifecycleStatus === "REQUEST_SENT").length,
    readyToMessage: active.filter(isReadyForInitialMessage).length,
    followUpsDue: active.filter((c) => isFollowUpDue(c, now)).length,
    replied: active.filter((c) => c.lifecycleStatus === "REPLIED").length,
    active: active.length,
    actionable: countActionable(contacts, now),
    newSinceReview: active.filter(isNewSinceReview).length,
  };
}

export type ContactTab = "all" | "pending" | "ready" | "followups" | "archived";

export function tabFilter(tab: ContactTab): (c: Contact) => boolean {
  switch (tab) {
    case "all":
      return (c) => !c.archivedAt;
    case "pending":
      return (c) => !c.archivedAt && c.lifecycleStatus === "REQUEST_SENT";
    case "ready":
      return isReadyForInitialMessage;
    case "followups":
      // Due first, but the tab also lists upcoming reminders.
      return (c) => !c.archivedAt && !!c.nextFollowUpAt;
    case "archived":
      return (c) => !!c.archivedAt;
  }
  return () => true;
}

export interface ContactQuery {
  search: string;
  status: LifecycleStatus | "FOLLOW_UP_DUE" | "";
  category: Category | "";
  sort: SortKey;
}

export type SortKey =
  | "priority"
  | "nextFollowUp"
  | "requestDate"
  | "acceptedDate"
  | "name"
  | "updated";

export const SORT_LABELS: Record<SortKey, string> = {
  priority: "Priority, then due date",
  nextFollowUp: "Next follow-up (soonest)",
  requestDate: "Request date (newest)",
  acceptedDate: "Acceptance date (newest)",
  name: "Name (A–Z)",
  updated: "Recently updated",
};

export function matchesSearch(c: Contact, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [c.fullName, c.company, c.role, c.notes, c.connectionReason, c.normalizedProfileUrl, c.profileUrl].some((v) =>
    v.toLowerCase().includes(q),
  );
}

const time = (v: string | null) => (v ? Date.parse(v) : null);

function nullsLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

export function compareContacts(sort: SortKey, now: Date): (a: Contact, b: Contact) => number {
  const byName = (a: Contact, b: Contact) => a.fullName.localeCompare(b.fullName);
  switch (sort) {
    case "priority":
      return (a, b) =>
        Number(b.priority) - Number(a.priority) ||
        Number(isFollowUpDue(b, now) || isReadyForInitialMessage(b)) - Number(isFollowUpDue(a, now) || isReadyForInitialMessage(a)) ||
        nullsLast(time(a.nextFollowUpAt), time(b.nextFollowUpAt), 1) ||
        byName(a, b);
    case "nextFollowUp":
      return (a, b) => nullsLast(time(a.nextFollowUpAt), time(b.nextFollowUpAt), 1) || byName(a, b);
    case "requestDate":
      return (a, b) => b.requestSentAt.localeCompare(a.requestSentAt) || byName(a, b);
    case "acceptedDate":
      return (a, b) => nullsLast(time(a.acceptedAt), time(b.acceptedAt), -1) || byName(a, b);
    case "name":
      return byName;
    case "updated":
      return (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  }
  return byName;
}

export function queryContacts(contacts: readonly Contact[], tab: ContactTab, q: ContactQuery, now: Date): Contact[] {
  const inTab = tabFilter(tab);
  return contacts
    .filter(inTab)
    .filter((c) => matchesSearch(c, q.search))
    .filter((c) => (q.status === "" ? true : q.status === "FOLLOW_UP_DUE" ? isFollowUpDue(c, now) : c.lifecycleStatus === q.status))
    .filter((c) => (q.category === "" ? true : c.category === q.category))
    .sort(compareContacts(q.sort, now));
}

/**
 * "Who should I follow up with today?": overdue follow-ups and accepted contacts awaiting a first
 * message. Starred contacts first, then overdue reminders (most overdue first), then the rest.
 */
export function todayList(contacts: readonly Contact[], now: Date): Contact[] {
  const items = contacts.filter((c) => isFollowUpDue(c, now) || isReadyForInitialMessage(c));
  return items.sort(
    (a, b) =>
      Number(b.priority) - Number(a.priority) ||
      Number(isFollowUpDue(b, now)) - Number(isFollowUpDue(a, now)) ||
      nullsLast(time(a.nextFollowUpAt), time(b.nextFollowUpAt), 1) ||
      nullsLast(time(a.acceptedAt), time(b.acceptedAt), 1) ||
      a.fullName.localeCompare(b.fullName),
  );
}
