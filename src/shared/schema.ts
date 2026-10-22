// Runtime validation, defaults and schema migrations for stored data and backups.

import { z } from "zod";
import {
  ACTIVITY_TYPES,
  CATEGORIES,
  LIFECYCLE_STATUSES,
  SCHEMA_VERSION,
  type Activity,
  type Contact,
  type Database,
  type Settings,
  type Template,
} from "./types";
import { isDateOnly, isTimestamp } from "./time";
import { normalizeProfileUrl } from "./profileUrl";
import { defaultTemplateMapping, STARTER_TEMPLATE_IDS, starterTemplates } from "./templates";
import { deriveStatus } from "./lifecycle";

const timestamp = z.string().refine(isTimestamp, "must be an ISO timestamp");
const nullableTimestamp = timestamp.nullable().default(null);
const text = (max: number) => z.string().max(max).default("");

export const contactSchema = z.object({
  id: z.string().min(1).max(100),
  profileUrl: z.string().max(2000).default(""),
  normalizedProfileUrl: z.string().max(2000),
  fullName: z.string().trim().min(1).max(200),
  firstNameOverride: text(100),
  company: text(200),
  role: text(200),
  category: z.enum(CATEGORIES).catch("OTHER"),
  connectionReason: text(2000),
  notes: text(20000),
  priority: z.boolean().default(false),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES).catch("REQUEST_SENT"),
  requestSentAt: z.string().refine(isDateOnly, "must be YYYY-MM-DD"),
  acceptedAt: nullableTimestamp,
  acceptanceSource: z.literal("MANUAL").nullable().default(null),
  initialMessageSentAt: nullableTimestamp,
  lastMessageSentAt: nullableTimestamp,
  repliedAt: nullableTimestamp,
  nextFollowUpAt: nullableTimestamp,
  archivedAt: nullableTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  lastReviewedAt: nullableTimestamp,
  isDemo: z.boolean().default(false),
});

export const activitySchema = z.object({
  id: z.string().min(1).max(100),
  contactId: z.string().min(1).max(100),
  activityType: z.enum(ACTIVITY_TYPES),
  timestamp,
  templateId: z.string().max(100).optional(),
  messageText: z.string().max(20000).optional(),
  note: z.string().max(5000).optional(),
});

export const templateSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  body: z.string().max(8000),
  isStarter: z.boolean().default(false),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const templateRef = z.string().max(100).nullable().catch(null);

export function defaultSettings(): Settings {
  return {
    myName: "",
    myTitle: "",
    myCompany: "",
    communityUrl: "",
    timeZone: "",
    theme: "system",
    desktopReminders: false,
    defaultFollowUpDays: 7,
    defaultTemplateByCategory: defaultTemplateMapping(),
    followUpTemplateId: STARTER_TEMPLATE_IDS.followUp,
  };
}

/** Lenient: each invalid field falls back to its default instead of failing the whole object. */
export const settingsSchema = z.object({
  myName: z.string().max(200).catch(""),
  myTitle: z.string().max(200).catch(""),
  myCompany: z.string().max(200).catch(""),
  communityUrl: z.string().max(2000).catch(""),
  timeZone: z.string().max(100).catch(""),
  theme: z.enum(["system", "light", "dark"]).catch("system"),
  desktopReminders: z.boolean().catch(false),
  defaultFollowUpDays: z.number().int().min(1).max(365).catch(7),
  defaultTemplateByCategory: z
    .object(Object.fromEntries(CATEGORIES.map((c) => [c, templateRef])) as Record<(typeof CATEGORIES)[number], typeof templateRef>)
    .catch(() => defaultTemplateMapping()),
  followUpTemplateId: templateRef,
});

export function createEmptyDatabase(nowIso: string): Database {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    contacts: [],
    activities: [],
    templates: starterTemplates(nowIso),
    settings: defaultSettings(),
    reminders: { notifiedKeys: [], lastReconciledAt: null },
    quarantine: [],
  };
}

export class FutureSchemaError extends Error {
  override name = "FutureSchemaError";
  constructor(public readonly found: number) {
    super(
      `Your saved data uses schema version ${found}, which is newer than this extension supports (${SCHEMA_VERSION}). ` +
        "Update LinkedMaven Connect; no changes will be written until then.",
    );
  }
}

export class CorruptDataError extends Error {
  override name = "CorruptDataError";
}

/** Step migrations: MIGRATIONS[n] upgrades a version-n document to version n+1. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // Version 0 = unversioned prototype data containing only a contacts array.
  0: (doc) => ({ ...doc, schemaVersion: 1 }),
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recomputes derived fields so stored status always agrees with timestamps. */
export function normalizeContact(c: Contact): Contact {
  const n = normalizeProfileUrl(c.normalizedProfileUrl || c.profileUrl);
  return {
    ...c,
    normalizedProfileUrl: n.ok ? n.normalized : c.normalizedProfileUrl,
    acceptanceSource: c.acceptedAt ? "MANUAL" : null,
    lifecycleStatus: deriveStatus(c),
  };
}

export interface MigrationResult {
  db: Database;
  /** True when the stored document should be rewritten. */
  changed: boolean;
  /** Human-readable notes about repaired or quarantined records. */
  notes: string[];
}

/**
 * Upgrades and repairs a stored document. Invalid records are moved to `quarantine` (and
 * reported) rather than dropped. Throws FutureSchemaError for newer versions and
 * CorruptDataError if the document is not an object at all.
 */
export function migrateDatabase(raw: unknown, nowIso: string): MigrationResult {
  if (raw === undefined || raw === null) return { db: createEmptyDatabase(nowIso), changed: true, notes: [] };
  if (!isRecord(raw)) throw new CorruptDataError("Stored data is not an object.");

  let doc: Record<string, unknown> = { ...raw };
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (!Number.isInteger(version) || version < 0) throw new CorruptDataError("Stored schema version is invalid.");
  if (version > SCHEMA_VERSION) throw new FutureSchemaError(version);
  let changed = false;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new CorruptDataError(`No migration from schema version ${version}.`);
    doc = step(doc);
    version += 1;
    changed = true;
  }

  const notes: string[] = [];
  const quarantine: unknown[] = Array.isArray(doc.quarantine) ? [...doc.quarantine] : [];
  const quarantineItem = (kind: string, value: unknown, reason: string) => {
    quarantine.push({ kind, reason, quarantinedAt: nowIso, value });
    notes.push(`${kind} moved to quarantine: ${reason}`);
    changed = true;
  };

  const contacts: Contact[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  for (const item of Array.isArray(doc.contacts) ? doc.contacts : []) {
    const parsed = contactSchema.safeParse(item);
    if (!parsed.success) {
      quarantineItem("contact", item, parsed.error.issues[0]?.message ?? "invalid");
      continue;
    }
    const c = normalizeContact(parsed.data as Contact);
    if (seenIds.has(c.id) || seenUrls.has(c.normalizedProfileUrl)) {
      quarantineItem("contact", item, "duplicate id or profile URL");
      continue;
    }
    if (JSON.stringify(c) !== JSON.stringify(item)) changed = true;
    seenIds.add(c.id);
    seenUrls.add(c.normalizedProfileUrl);
    contacts.push(c);
  }

  const activities: Activity[] = [];
  for (const item of Array.isArray(doc.activities) ? doc.activities : []) {
    const parsed = activitySchema.safeParse(item);
    if (!parsed.success) quarantineItem("activity", item, parsed.error.issues[0]?.message ?? "invalid");
    else if (!seenIds.has(parsed.data.contactId)) quarantineItem("activity", item, "contact not found");
    else activities.push(parsed.data);
  }

  const templates: Template[] = [];
  const hasTemplates = Array.isArray(doc.templates);
  for (const item of hasTemplates ? (doc.templates as unknown[]) : []) {
    const parsed = templateSchema.safeParse(item);
    if (!parsed.success) quarantineItem("template", item, parsed.error.issues[0]?.message ?? "invalid");
    else if (templates.some((t) => t.id === parsed.data.id)) quarantineItem("template", item, "duplicate id");
    else templates.push(parsed.data);
  }

  const settings = settingsSchema.parse(isRecord(doc.settings) ? doc.settings : {}) as Settings;
  const reminders = isRecord(doc.reminders) ? doc.reminders : {};

  const db: Database = {
    schemaVersion: SCHEMA_VERSION,
    revision: typeof doc.revision === "number" && Number.isFinite(doc.revision) ? doc.revision : 0,
    contacts,
    activities,
    templates: hasTemplates ? templates : starterTemplates(nowIso),
    settings,
    reminders: {
      notifiedKeys: Array.isArray(reminders.notifiedKeys)
        ? reminders.notifiedKeys.filter((k): k is string => typeof k === "string")
        : [],
      lastReconciledAt: isTimestamp(reminders.lastReconciledAt) ? reminders.lastReconciledAt : null,
    },
    quarantine,
  };
  if (!hasTemplates || !isRecord(doc.settings) || !isRecord(doc.reminders)) changed = true;
  return { db, changed, notes };
}
