// Lifecycle transitions and derived states. All functions are pure: they take a contact and
// return an updated copy plus the activity entry to record, or throw a TransitionError.

import type { Activity, ActivityType, Contact, LifecycleStatus } from "./types";
import { dateInZone, isDateOnly, isTimestamp } from "./time";
import { newId } from "./ids";

export class TransitionError extends Error {
  override name = "TransitionError";
}

/**
 * The lifecycle status implied by a contact's timestamps. Storing a status that disagrees with
 * the timestamps is never allowed, so every transition ends by recomputing it from here.
 * REPLIED is sticky: a later outgoing message does not hide that the person replied.
 */
export function deriveStatus(c: Pick<Contact, "archivedAt" | "repliedAt" | "lastMessageSentAt" | "acceptedAt">): LifecycleStatus {
  if (c.archivedAt) return "ARCHIVED";
  if (c.repliedAt) return "REPLIED";
  if (c.lastMessageSentAt) return "MESSAGE_SENT";
  if (c.acceptedAt) return "ACCEPTED";
  return "REQUEST_SENT";
}

/** Status ignoring archival, i.e. what a restored contact returns to. */
export function activeStatus(c: Contact): Exclude<LifecycleStatus, "ARCHIVED"> {
  return deriveStatus({ ...c, archivedAt: null }) as Exclude<LifecycleStatus, "ARCHIVED">;
}

export function isFollowUpDue(c: Contact, now: Date = new Date()): boolean {
  if (c.archivedAt || !c.nextFollowUpAt) return false;
  const due = Date.parse(c.nextFollowUpAt);
  return !Number.isNaN(due) && due <= now.getTime();
}

export function isReadyForInitialMessage(c: Contact): boolean {
  return !c.archivedAt && c.lifecycleStatus === "ACCEPTED" && !c.initialMessageSentAt;
}

export function isActionable(c: Contact, now: Date = new Date()): boolean {
  return isReadyForInitialMessage(c) || isFollowUpDue(c, now);
}

/** Unique contacts that need action; a contact that is both ready and due counts once. */
export function countActionable(contacts: readonly Contact[], now: Date = new Date()): number {
  return contacts.reduce((n, c) => (isActionable(c, now) ? n + 1 : n), 0);
}

/** Acceptances the user confirmed but has not opened since. Never implies automatic detection. */
export function isNewSinceReview(c: Contact): boolean {
  return !c.archivedAt && !!c.acceptedAt && !c.lastReviewedAt;
}

export interface TransitionResult {
  contact: Contact;
  activity: Activity;
}

function activity(contactId: string, type: ActivityType, at: string, extra: Partial<Activity> = {}): Activity {
  return { id: newId(), contactId, activityType: type, timestamp: at, ...extra };
}

function finish(c: Contact, nowIso: string): Contact {
  const next = { ...c, updatedAt: nowIso };
  next.lifecycleStatus = deriveStatus(next);
  return next;
}

function requireActive(c: Contact) {
  if (c.archivedAt) throw new TransitionError("Restore this contact before changing its status.");
}

function requireTimestamp(value: string, label: string) {
  if (!isTimestamp(value)) throw new TransitionError(`${label} is not a valid date and time.`);
}

/**
 * Returns the problems with a contact's timeline, or an empty list if it is consistent.
 * Ordering: request date <= acceptance <= first message <= last message; reply after acceptance.
 */
export function validateTimeline(c: Contact, tz: string): string[] {
  const errors: string[] = [];
  if (!isDateOnly(c.requestSentAt)) errors.push("Request sent date is invalid.");
  const ts = (v: string | null) => (v ? Date.parse(v) : null);
  const accepted = ts(c.acceptedAt);
  const first = ts(c.initialMessageSentAt);
  const last = ts(c.lastMessageSentAt);
  const replied = ts(c.repliedAt);

  if (accepted !== null && isDateOnly(c.requestSentAt) && dateInZone(accepted, tz) < c.requestSentAt) {
    errors.push("Acceptance can't be before the request was sent.");
  }
  if ((first !== null || last !== null || replied !== null) && accepted === null) {
    errors.push("Messages and replies require a confirmed acceptance.");
  }
  if (first !== null && accepted !== null && first < accepted) errors.push("The first message can't be before acceptance.");
  if (first !== null && last === null) errors.push("Last message date is missing.");
  if (last !== null && first === null) errors.push("First message date is missing.");
  if (first !== null && last !== null && last < first) errors.push("The last message can't be before the first message.");
  if (replied !== null && accepted !== null && replied < accepted) errors.push("A reply can't be before acceptance.");
  return errors;
}

export function markAccepted(c: Contact, acceptedAt: string, nowIso: string, tz: string): TransitionResult {
  requireActive(c);
  if (c.lifecycleStatus !== "REQUEST_SENT") throw new TransitionError("This contact is already marked as accepted.");
  requireTimestamp(acceptedAt, "Acceptance date");
  if (Date.parse(acceptedAt) > Date.parse(nowIso) + 60_000) throw new TransitionError("Acceptance date can't be in the future.");
  const next = finish(
    { ...c, acceptedAt, acceptanceSource: "MANUAL", lastReviewedAt: null },
    nowIso,
  );
  const problems = validateTimeline(next, tz);
  if (problems.length) throw new TransitionError(problems[0]);
  return { contact: next, activity: activity(c.id, "ACCEPTED", nowIso, { note: `Acceptance confirmed manually (accepted ${acceptedAt}).` }) };
}

export interface MessageSentInput {
  sentAt: string;
  templateId?: string | null;
  messageText?: string;
  /** Optional reminder to follow up. Omitted/null clears any existing reminder. */
  followUpAt?: string | null;
}

export function markMessageSent(c: Contact, input: MessageSentInput, nowIso: string, tz: string): TransitionResult {
  requireActive(c);
  if (!c.acceptedAt) throw new TransitionError("Confirm the acceptance before recording a message.");
  requireTimestamp(input.sentAt, "Sent date");
  if (Date.parse(input.sentAt) > Date.parse(nowIso) + 60_000) throw new TransitionError("Sent date can't be in the future.");
  if (input.followUpAt) requireTimestamp(input.followUpAt, "Follow-up date");
  const isFirst = !c.initialMessageSentAt;
  if (!isFirst && c.lastMessageSentAt && Date.parse(input.sentAt) < Date.parse(c.lastMessageSentAt)) {
    throw new TransitionError("This message can't be earlier than the last recorded message.");
  }
  const next = finish(
    {
      ...c,
      initialMessageSentAt: isFirst ? input.sentAt : c.initialMessageSentAt,
      lastMessageSentAt: input.sentAt,
      nextFollowUpAt: input.followUpAt ?? null,
    },
    nowIso,
  );
  const problems = validateTimeline(next, tz);
  if (problems.length) throw new TransitionError(problems[0]);
  return {
    contact: next,
    activity: activity(c.id, "MESSAGE_SENT", nowIso, {
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.messageText ? { messageText: input.messageText } : {}),
      note: isFirst ? "First message." : "Follow-up message.",
    }),
  };
}

export function markReplied(c: Contact, repliedAt: string, nowIso: string, tz: string): TransitionResult {
  requireActive(c);
  if (!c.acceptedAt) throw new TransitionError("Confirm the acceptance before recording a reply.");
  if (c.repliedAt) throw new TransitionError("A reply is already recorded.");
  requireTimestamp(repliedAt, "Reply date");
  // Replying clears the reminder; a new one is only created if the user schedules it.
  const next = finish({ ...c, repliedAt, nextFollowUpAt: null }, nowIso);
  const problems = validateTimeline(next, tz);
  if (problems.length) throw new TransitionError(problems[0]);
  return { contact: next, activity: activity(c.id, "REPLIED", nowIso) };
}

export function scheduleFollowUp(c: Contact, at: string, nowIso: string): TransitionResult {
  requireActive(c);
  requireTimestamp(at, "Follow-up date");
  const next = finish({ ...c, nextFollowUpAt: at }, nowIso);
  return { contact: next, activity: activity(c.id, "FOLLOW_UP_SCHEDULED", nowIso, { note: `Follow-up set for ${at}.` }) };
}

export function clearFollowUp(c: Contact, nowIso: string): TransitionResult {
  const next = finish({ ...c, nextFollowUpAt: null }, nowIso);
  return { contact: next, activity: activity(c.id, "FOLLOW_UP_CLEARED", nowIso) };
}

export function archive(c: Contact, nowIso: string): TransitionResult {
  if (c.archivedAt) throw new TransitionError("This contact is already archived.");
  const next = finish({ ...c, archivedAt: nowIso, nextFollowUpAt: null }, nowIso);
  return { contact: next, activity: activity(c.id, "ARCHIVED", nowIso) };
}

export function restore(c: Contact, nowIso: string): TransitionResult {
  if (!c.archivedAt) throw new TransitionError("This contact isn't archived.");
  const next = finish({ ...c, archivedAt: null }, nowIso);
  return { contact: next, activity: activity(c.id, "RESTORED", nowIso) };
}

/**
 * Moves a contact back to an earlier stage to correct a mistake, clearing every timestamp that
 * belongs to later stages so the record never contradicts itself.
 */
export function correctStatus(
  c: Contact,
  target: Exclude<LifecycleStatus, "ARCHIVED">,
  nowIso: string,
): TransitionResult {
  requireActive(c);
  const order: LifecycleStatus[] = ["REQUEST_SENT", "ACCEPTED", "MESSAGE_SENT", "REPLIED"];
  const current = order.indexOf(c.lifecycleStatus);
  const wanted = order.indexOf(target);
  if (wanted >= current) {
    throw new TransitionError("Corrections can only move a contact back to an earlier status. Use the normal actions to move forward.");
  }
  const next: Contact = { ...c };
  if (wanted < 3) next.repliedAt = null;
  if (wanted < 2) {
    next.initialMessageSentAt = null;
    next.lastMessageSentAt = null;
  }
  if (wanted < 1) {
    next.acceptedAt = null;
    next.acceptanceSource = null;
  }
  const done = finish(next, nowIso);
  return {
    contact: done,
    activity: activity(c.id, "STATUS_CORRECTED", nowIso, { note: `Status corrected from ${c.lifecycleStatus} to ${target}.` }),
  };
}
