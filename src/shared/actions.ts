// Domain operations applied to a Database copy inside `Repository.mutate`.
// Each throws on invalid input so nothing is written.

import type { Activity, Category, Contact, Database, Settings, Template } from "./types";
import { CATEGORIES } from "./types";
import { findDuplicate, normalizeProfileUrl } from "./profileUrl";
import { newId } from "./ids";
import { TransitionError, deriveStatus, validateTimeline, type TransitionResult } from "./lifecycle";
import { isDateOnly, resolveTimeZone, todayInZone } from "./time";

export class ValidationError extends Error {
  override name = "ValidationError";
}

export class DuplicateContactError extends Error {
  override name = "DuplicateContactError";
  constructor(public readonly existing: Contact) {
    super(`${existing.fullName} is already being tracked.`);
  }
}

export interface ContactInput {
  profileUrl: string;
  fullName: string;
  firstNameOverride?: string;
  company?: string;
  role?: string;
  category: Category;
  connectionReason?: string;
  notes?: string;
  requestSentAt: string;
  priority?: boolean;
}

export function tzOf(db: Database): string {
  return resolveTimeZone(db.settings.timeZone);
}

function clean(value: string | undefined, max: number, label: string): string {
  const v = (value ?? "").trim();
  if (v.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return v;
}

function validateRequestDate(value: string, tz: string, now: Date) {
  if (!isDateOnly(value)) throw new ValidationError("Request sent date must be a valid date.");
  if (value > todayInZone(tz, now)) throw new ValidationError("Request sent date can't be in the future.");
}

function getContact(db: Database, id: string): { contact: Contact; index: number } {
  const index = db.contacts.findIndex((c) => c.id === id);
  if (index < 0) throw new ValidationError("This contact no longer exists. It may have been deleted in another window.");
  return { contact: db.contacts[index]!, index };
}

function pushActivity(db: Database, a: Activity) {
  db.activities.push(a);
}

export function addContact(db: Database, input: ContactInput, now: Date, opts: { isDemo?: boolean } = {}): Contact {
  const tz = tzOf(db);
  const url = normalizeProfileUrl(input.profileUrl);
  if (!url.ok) throw new ValidationError(url.error);
  const dup = findDuplicate(db.contacts, url.normalized);
  if (dup) throw new DuplicateContactError(dup);
  const fullName = clean(input.fullName, 200, "Full name");
  if (!fullName) throw new ValidationError("Full name is required.");
  if (!CATEGORIES.includes(input.category)) throw new ValidationError("Choose a category.");
  validateRequestDate(input.requestSentAt, tz, now);

  const nowIso = now.toISOString();
  const contact: Contact = {
    id: newId(),
    profileUrl: input.profileUrl.trim(),
    normalizedProfileUrl: url.normalized,
    fullName,
    firstNameOverride: clean(input.firstNameOverride, 100, "First name"),
    company: clean(input.company, 200, "Company"),
    role: clean(input.role, 200, "Role"),
    category: input.category,
    connectionReason: clean(input.connectionReason, 2000, "Why I connected"),
    notes: clean(input.notes, 20000, "Notes"),
    priority: !!input.priority,
    lifecycleStatus: "REQUEST_SENT",
    requestSentAt: input.requestSentAt,
    acceptedAt: null,
    acceptanceSource: null,
    initialMessageSentAt: null,
    lastMessageSentAt: null,
    repliedAt: null,
    nextFollowUpAt: null,
    archivedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastReviewedAt: null,
    isDemo: !!opts.isDemo,
  };
  db.contacts.push(contact);
  pushActivity(db, { id: newId(), contactId: contact.id, activityType: "CREATED", timestamp: nowIso, note: "Connection request tracked." });
  return contact;
}

export type ContactPatch = Partial<
  Pick<
    Contact,
    | "profileUrl"
    | "fullName"
    | "firstNameOverride"
    | "company"
    | "role"
    | "category"
    | "connectionReason"
    | "notes"
    | "priority"
    | "requestSentAt"
    | "acceptedAt"
    | "initialMessageSentAt"
    | "lastMessageSentAt"
    | "repliedAt"
  >
>;

const FIELD_LABELS: Record<keyof ContactPatch, string> = {
  profileUrl: "profile URL",
  fullName: "name",
  firstNameOverride: "first name",
  company: "company",
  role: "role",
  category: "category",
  connectionReason: "reason",
  notes: "notes",
  priority: "priority",
  requestSentAt: "request date",
  acceptedAt: "acceptance date",
  initialMessageSentAt: "first message date",
  lastMessageSentAt: "last message date",
  repliedAt: "reply date",
};

/**
 * Edits contact fields. Stage timestamps can be corrected but not newly set or cleared here
 * (use the lifecycle actions / status correction for that), so status and timestamps stay consistent.
 */
export function updateContact(db: Database, id: string, patch: ContactPatch, now: Date): Contact {
  const tz = tzOf(db);
  const { contact, index } = getContact(db, id);
  const next: Contact = { ...contact };

  if (patch.profileUrl !== undefined && patch.profileUrl.trim() !== contact.profileUrl) {
    const url = normalizeProfileUrl(patch.profileUrl);
    if (!url.ok) throw new ValidationError(url.error);
    const dup = findDuplicate(db.contacts, url.normalized, id);
    if (dup) throw new DuplicateContactError(dup);
    next.profileUrl = patch.profileUrl.trim();
    next.normalizedProfileUrl = url.normalized;
  }
  if (patch.fullName !== undefined) {
    next.fullName = clean(patch.fullName, 200, "Full name");
    if (!next.fullName) throw new ValidationError("Full name is required.");
  }
  if (patch.firstNameOverride !== undefined) next.firstNameOverride = clean(patch.firstNameOverride, 100, "First name");
  if (patch.company !== undefined) next.company = clean(patch.company, 200, "Company");
  if (patch.role !== undefined) next.role = clean(patch.role, 200, "Role");
  if (patch.connectionReason !== undefined) next.connectionReason = clean(patch.connectionReason, 2000, "Why I connected");
  if (patch.notes !== undefined) next.notes = clean(patch.notes, 20000, "Notes");
  if (patch.priority !== undefined) next.priority = !!patch.priority;
  if (patch.category !== undefined) {
    if (!CATEGORIES.includes(patch.category)) throw new ValidationError("Choose a category.");
    next.category = patch.category;
  }
  if (patch.requestSentAt !== undefined) {
    validateRequestDate(patch.requestSentAt, tz, now);
    next.requestSentAt = patch.requestSentAt;
  }
  for (const key of ["acceptedAt", "initialMessageSentAt", "lastMessageSentAt", "repliedAt"] as const) {
    const value = patch[key];
    if (value === undefined || value === contact[key]) continue;
    if (!contact[key] || !value) {
      throw new ValidationError(`Use the status actions to set or clear the ${FIELD_LABELS[key]}.`);
    }
    if (Date.parse(value) > now.getTime() + 60_000) throw new ValidationError(`The ${FIELD_LABELS[key]} can't be in the future.`);
    next[key] = value;
  }

  const problems = validateTimeline(next, tz);
  if (problems.length) throw new ValidationError(problems[0]);

  const changed = (Object.keys(patch) as Array<keyof ContactPatch>).filter((k) => next[k] !== contact[k]);
  if (changed.length === 0) return contact;
  next.lifecycleStatus = deriveStatus(next);
  next.updatedAt = now.toISOString();
  db.contacts[index] = next;
  pushActivity(db, {
    id: newId(),
    contactId: id,
    activityType: changed.length === 1 && changed[0] === "notes" ? "NOTE" : "UPDATED",
    timestamp: next.updatedAt,
    note: `Edited ${changed.map((k) => FIELD_LABELS[k]).join(", ")}.`,
  });
  return next;
}

/** Runs a lifecycle transition (see lifecycle.ts) against a stored contact. */
export function applyTransition(
  db: Database,
  id: string,
  transition: (c: Contact, nowIso: string, tz: string) => TransitionResult,
  now: Date,
): Contact {
  const { contact, index } = getContact(db, id);
  let r: TransitionResult;
  try {
    r = transition(contact, now.toISOString(), tzOf(db));
  } catch (err) {
    if (err instanceof TransitionError) throw new ValidationError(err.message);
    throw err;
  }
  db.contacts[index] = r.contact;
  pushActivity(db, r.activity);
  return r.contact;
}

export function deleteContact(db: Database, id: string) {
  getContact(db, id);
  db.contacts = db.contacts.filter((c) => c.id !== id);
  db.activities = db.activities.filter((a) => a.contactId !== id);
  db.reminders.notifiedKeys = db.reminders.notifiedKeys.filter((k) => !k.startsWith(`${id}|`));
}

export function markReviewed(db: Database, ids: readonly string[], now: Date) {
  const set = new Set(ids);
  const nowIso = now.toISOString();
  db.contacts = db.contacts.map((c) => (set.has(c.id) && c.acceptedAt && !c.lastReviewedAt ? { ...c, lastReviewedAt: nowIso } : c));
}

// ---- Templates ----

export function createTemplate(db: Database, input: { name: string; body: string }, now: Date): Template {
  const name = clean(input.name, 200, "Template name");
  if (!name) throw new ValidationError("Template name is required.");
  if (input.body.length > 8000) throw new ValidationError("Template is too long (8,000 characters max).");
  const nowIso = now.toISOString();
  const t: Template = { id: newId(), name, body: input.body, isStarter: false, createdAt: nowIso, updatedAt: nowIso };
  db.templates.push(t);
  return t;
}

export function updateTemplate(db: Database, id: string, input: { name: string; body: string }, now: Date): Template {
  const index = db.templates.findIndex((t) => t.id === id);
  if (index < 0) throw new ValidationError("This template no longer exists.");
  const name = clean(input.name, 200, "Template name");
  if (!name) throw new ValidationError("Template name is required.");
  if (input.body.length > 8000) throw new ValidationError("Template is too long (8,000 characters max).");
  const t = { ...db.templates[index]!, name, body: input.body, updatedAt: now.toISOString() };
  db.templates[index] = t;
  return t;
}

export function duplicateTemplate(db: Database, id: string, now: Date): Template {
  const src = db.templates.find((t) => t.id === id);
  if (!src) throw new ValidationError("This template no longer exists.");
  return createTemplate(db, { name: `${src.name} (copy)`, body: src.body }, now);
}

export function deleteTemplate(db: Database, id: string) {
  if (!db.templates.some((t) => t.id === id)) throw new ValidationError("This template no longer exists.");
  db.templates = db.templates.filter((t) => t.id !== id);
  for (const cat of CATEGORIES) {
    if (db.settings.defaultTemplateByCategory[cat] === id) db.settings.defaultTemplateByCategory[cat] = null;
  }
  if (db.settings.followUpTemplateId === id) db.settings.followUpTemplateId = null;
}

export function updateSettings(db: Database, patch: Partial<Settings>) {
  const next = { ...db.settings, ...patch };
  if (!Number.isInteger(next.defaultFollowUpDays) || next.defaultFollowUpDays < 1 || next.defaultFollowUpDays > 365) {
    throw new ValidationError("Default follow-up interval must be between 1 and 365 days.");
  }
  for (const key of ["myName", "myTitle", "myCompany"] as const) clean(next[key], 200, key);
  if (next.communityUrl.trim()) {
    try {
      const u = new URL(next.communityUrl.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      throw new ValidationError("Community URL must be a valid http(s) link.");
    }
  }
  db.settings = next;
}
