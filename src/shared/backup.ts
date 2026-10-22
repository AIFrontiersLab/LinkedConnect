// JSON backup export, strict import validation, and merge/replace planning.
//
// Merge rules:
//   * Contacts are matched by normalized profile URL. When both sides have the same person, the
//     version with the later `updatedAt` wins; ties keep the current record. The current record's
//     id is always kept, and the imported record's activities are re-pointed to it.
//   * An imported contact whose id clashes with a different current contact gets a new id.
//   * Activities are de-duplicated by id and by (contact, type, timestamp).
//   * Templates are matched by id; the later `updatedAt` wins. New templates are added.
//   * Settings and reminder state on this device are kept (Replace uses the backup's settings).
// A backup that fails any check is rejected as a whole; nothing is written.

import { z } from "zod";
import type { Activity, Contact, Database, Settings, Template } from "./types";
import { CATEGORIES, SCHEMA_VERSION } from "./types";
import { activitySchema, contactSchema, normalizeContact, settingsSchema, templateSchema } from "./schema";
import { normalizeProfileUrl } from "./profileUrl";
import { newId } from "./ids";
import { validateTimeline } from "./lifecycle";

export const BACKUP_FORMAT = "linkedmaven-connect-backup";
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: {
    contacts: Contact[];
    activities: Activity[];
    templates: Template[];
    settings: Settings;
  };
}

export function createBackup(db: Database, now: Date): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    data: {
      contacts: db.contacts,
      activities: db.activities,
      templates: db.templates,
      settings: db.settings,
    },
  };
}

export function backupFileName(today: string): string {
  return `linkedmaven-backup-${today}.json`;
}

const envelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  data: z.object({
    contacts: z.array(z.unknown()),
    activities: z.array(z.unknown()),
    templates: z.array(z.unknown()),
    settings: z.unknown(),
  }),
});

export type ParseBackupResult = { ok: true; backup: BackupFile } | { ok: false; error: string };

function issue(prefix: string, err: z.ZodError): string {
  const i = err.issues[0];
  return `${prefix}: ${i?.path.join(".") || "value"} ${i?.message ?? "is invalid"}`;
}

/** Parses and strictly validates a backup file's text. Never touches stored data. */
export function parseBackup(text: string): ParseBackupResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: "The file is too large to be a LinkedMaven backup." };
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "The file isn't valid JSON." };
  }
  const env = envelopeSchema.safeParse(raw);
  if (!env.success) return { ok: false, error: "This isn't a LinkedMaven Connect backup file." };
  const { schemaVersion, data } = env.data;
  if (schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: `This backup was made by a newer version (schema ${schemaVersion}). Update the extension first.` };
  }
  if (schemaVersion < 1) return { ok: false, error: `Backup schema version ${schemaVersion} is not supported.` };

  const contacts: Contact[] = [];
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const [i, item] of data.contacts.entries()) {
    const p = contactSchema.safeParse(item);
    if (!p.success) return { ok: false, error: issue(`Contact #${i + 1}`, p.error) };
    const url = normalizeProfileUrl(p.data.normalizedProfileUrl || p.data.profileUrl);
    if (!url.ok) return { ok: false, error: `Contact #${i + 1} (${p.data.fullName}): ${url.error}` };
    const c = normalizeContact({ ...(p.data as Contact), normalizedProfileUrl: url.normalized });
    const timeline = validateTimeline(c, "UTC");
    // The request date check is calendar-based; only reject on non-date problems here.
    const fatal = timeline.filter((t) => !t.startsWith("Acceptance can't be before"));
    if (fatal.length) return { ok: false, error: `Contact #${i + 1} (${c.fullName}): ${fatal[0]}` };
    if (ids.has(c.id)) return { ok: false, error: `Contact #${i + 1} repeats id ${c.id}.` };
    if (urls.has(c.normalizedProfileUrl)) return { ok: false, error: `Contact #${i + 1} repeats profile ${c.normalizedProfileUrl}.` };
    ids.add(c.id);
    urls.add(c.normalizedProfileUrl);
    contacts.push(c);
  }

  const activities: Activity[] = [];
  const activityIds = new Set<string>();
  for (const [i, item] of data.activities.entries()) {
    const p = activitySchema.safeParse(item);
    if (!p.success) return { ok: false, error: issue(`Activity #${i + 1}`, p.error) };
    if (!ids.has(p.data.contactId)) return { ok: false, error: `Activity #${i + 1} refers to a contact that isn't in the backup.` };
    if (activityIds.has(p.data.id)) return { ok: false, error: `Activity #${i + 1} repeats id ${p.data.id}.` };
    activityIds.add(p.data.id);
    activities.push(p.data);
  }

  const templates: Template[] = [];
  for (const [i, item] of data.templates.entries()) {
    const p = templateSchema.safeParse(item);
    if (!p.success) return { ok: false, error: issue(`Template #${i + 1}`, p.error) };
    if (templates.some((t) => t.id === p.data.id)) return { ok: false, error: `Template #${i + 1} repeats id ${p.data.id}.` };
    templates.push(p.data);
  }

  const settings = settingsSchema.parse(typeof data.settings === "object" && data.settings ? data.settings : {}) as Settings;
  return {
    ok: true,
    backup: { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: env.data.exportedAt, data: { contacts, activities, templates, settings } },
  };
}

export type ImportMode = "merge" | "replace";

export interface ImportSummary {
  contactsAdded: number;
  contactsUpdated: number;
  contactsKept: number;
  activitiesAdded: number;
  templatesAdded: number;
  templatesUpdated: number;
  /** Contacts that existed before and will no longer exist (replace mode). */
  contactsRemoved: number;
}

function fixTemplateRefs(settings: Settings, templates: readonly Template[]): Settings {
  const ok = (id: string | null) => (id && templates.some((t) => t.id === id) ? id : null);
  const mapping = { ...settings.defaultTemplateByCategory };
  for (const c of CATEGORIES) mapping[c] = ok(mapping[c]);
  return { ...settings, defaultTemplateByCategory: mapping, followUpTemplateId: ok(settings.followUpTemplateId) };
}

const activitySignature = (a: Activity) => `${a.contactId}|${a.activityType}|${a.timestamp}`;

/** Computes the resulting database (without writing) plus a summary for the preview. */
export function planImport(current: Database, backup: BackupFile, mode: ImportMode): { db: Database; summary: ImportSummary } {
  const summary: ImportSummary = {
    contactsAdded: 0,
    contactsUpdated: 0,
    contactsKept: 0,
    activitiesAdded: 0,
    templatesAdded: 0,
    templatesUpdated: 0,
    contactsRemoved: 0,
  };
  const incoming = backup.data;

  if (mode === "replace") {
    const keptUrls = new Set(incoming.contacts.map((c) => c.normalizedProfileUrl));
    summary.contactsRemoved = current.contacts.filter((c) => !keptUrls.has(c.normalizedProfileUrl)).length;
    summary.contactsAdded = incoming.contacts.length;
    summary.activitiesAdded = incoming.activities.length;
    summary.templatesAdded = incoming.templates.length;
    return {
      summary,
      db: {
        ...current,
        contacts: structuredClone(incoming.contacts),
        activities: structuredClone(incoming.activities),
        templates: structuredClone(incoming.templates),
        settings: fixTemplateRefs(structuredClone(incoming.settings), incoming.templates),
        reminders: { notifiedKeys: [], lastReconciledAt: current.reminders.lastReconciledAt },
      },
    };
  }

  const contacts = current.contacts.map((c) => ({ ...c }));
  const byUrl = new Map(contacts.map((c, i) => [c.normalizedProfileUrl, i]));
  const usedIds = new Set(contacts.map((c) => c.id));
  const idMap = new Map<string, string>(); // imported contact id -> resulting id

  for (const inc of incoming.contacts) {
    const idx = byUrl.get(inc.normalizedProfileUrl);
    if (idx !== undefined) {
      const existing = contacts[idx]!;
      idMap.set(inc.id, existing.id);
      if (Date.parse(inc.updatedAt) > Date.parse(existing.updatedAt)) {
        contacts[idx] = {
          ...structuredClone(inc),
          id: existing.id,
          createdAt: Date.parse(existing.createdAt) < Date.parse(inc.createdAt) ? existing.createdAt : inc.createdAt,
        };
        summary.contactsUpdated++;
      } else {
        summary.contactsKept++;
      }
      continue;
    }
    const id = usedIds.has(inc.id) ? newId() : inc.id;
    usedIds.add(id);
    idMap.set(inc.id, id);
    byUrl.set(inc.normalizedProfileUrl, contacts.length);
    contacts.push({ ...structuredClone(inc), id });
    summary.contactsAdded++;
  }

  const activities = [...current.activities];
  const actIds = new Set(activities.map((a) => a.id));
  const sigs = new Set(activities.map(activitySignature));
  for (const inc of incoming.activities) {
    const mapped: Activity = { ...inc, contactId: idMap.get(inc.contactId) ?? inc.contactId };
    if (sigs.has(activitySignature(mapped))) continue;
    if (actIds.has(mapped.id)) mapped.id = newId();
    actIds.add(mapped.id);
    sigs.add(activitySignature(mapped));
    activities.push(mapped);
    summary.activitiesAdded++;
  }

  const templates = current.templates.map((t) => ({ ...t }));
  for (const inc of incoming.templates) {
    const idx = templates.findIndex((t) => t.id === inc.id);
    if (idx < 0) {
      templates.push({ ...inc });
      summary.templatesAdded++;
    } else if (Date.parse(inc.updatedAt) > Date.parse(templates[idx]!.updatedAt)) {
      templates[idx] = { ...inc };
      summary.templatesUpdated++;
    }
  }

  return {
    summary,
    db: { ...current, contacts, activities, templates, settings: fixTemplateRefs(current.settings, templates) },
  };
}

/** Applies an import inside `mutate`. */
export function applyImport(db: Database, backup: BackupFile, mode: ImportMode): ImportSummary {
  const { db: next, summary } = planImport(db, backup, mode);
  db.contacts = next.contacts;
  db.activities = next.activities;
  db.templates = next.templates;
  db.settings = next.settings;
  db.reminders = next.reminders;
  return summary;
}

