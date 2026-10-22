import { describe, expect, it } from "vitest";
import { applyImport, createBackup, parseBackup, planImport } from "../src/shared/backup";
import { makeContact, makeDb, NOW } from "./helpers";
import type { Activity } from "../src/shared/types";

const act = (id: string, contactId: string, timestamp = "2026-10-10T12:00:00.000Z"): Activity => ({
  id,
  contactId,
  activityType: "CREATED",
  timestamp,
});

function roundTrip(db = makeDb([makeContact()])) {
  return JSON.stringify(createBackup(db, NOW));
}

describe("backup validation", () => {
  it("accepts a backup it created", () => {
    const r = parseBackup(roundTrip());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup.data.contacts).toHaveLength(1);
  });

  it("rejects malformed or unsupported files", () => {
    expect(parseBackup("not json").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: 1 })).ok).toBe(false);
    const future = JSON.parse(roundTrip());
    future.schemaVersion = 99;
    expect(parseBackup(JSON.stringify(future))).toMatchObject({ ok: false, error: expect.stringContaining("newer") });
    const badContact = JSON.parse(roundTrip());
    badContact.data.contacts[0].requestSentAt = "yesterday";
    expect(parseBackup(JSON.stringify(badContact)).ok).toBe(false);
    const badUrl = JSON.parse(roundTrip());
    badUrl.data.contacts[0].normalizedProfileUrl = "https://evil.com/in/x";
    badUrl.data.contacts[0].profileUrl = "https://evil.com/in/x";
    expect(parseBackup(JSON.stringify(badUrl)).ok).toBe(false);
    const orphan = JSON.parse(roundTrip());
    orphan.data.activities.push(act("x", "missing"));
    expect(parseBackup(JSON.stringify(orphan)).ok).toBe(false);
    const contradictory = JSON.parse(roundTrip());
    contradictory.data.contacts[0].repliedAt = "2026-10-12T00:00:00.000Z";
    expect(parseBackup(JSON.stringify(contradictory)).ok).toBe(false);
  });

  it("rejects duplicate profiles inside one backup", () => {
    const db = makeDb([makeContact({ id: "a" }), makeContact({ id: "b", profileUrl: "https://uk.linkedin.com/in/Jane-Doe/" })]);
    expect(parseBackup(roundTrip(db)).ok).toBe(false);
  });
});

describe("merge and replace", () => {
  const parse = (db: ReturnType<typeof makeDb>) => {
    const r = parseBackup(roundTrip(db));
    if (!r.ok) throw new Error(r.error);
    return r.backup;
  };

  it("deduplicates by normalized URL; newer updatedAt wins; current id is kept and activities remapped", () => {
    const current = makeDb([makeContact({ id: "local", company: "Old Co", updatedAt: "2026-10-11T00:00:00.000Z" })]);
    current.activities = [act("a1", "local")];
    const incoming = makeDb([
      makeContact({ id: "remote", company: "New Co", updatedAt: "2026-10-12T00:00:00.000Z" }),
      makeContact({ id: "local", fullName: "Other Person", normalizedProfileUrl: "https://www.linkedin.com/in/other", profileUrl: "https://www.linkedin.com/in/other" }),
    ]);
    incoming.activities = [act("r1", "remote", "2026-10-12T00:00:00.000Z"), act("r2", "local")];
    const { db, summary } = planImport(current, parse(incoming), "merge");

    expect(summary).toMatchObject({ contactsUpdated: 1, contactsAdded: 1, contactsKept: 0 });
    const jane = db.contacts.find((c) => c.normalizedProfileUrl.endsWith("/jane-doe"))!;
    expect(jane.id).toBe("local");
    expect(jane.company).toBe("New Co");
    // Imported "local" id clashed with a different person, so it got a new id.
    const other = db.contacts.find((c) => c.normalizedProfileUrl.endsWith("/other"))!;
    expect(other.id).not.toBe("local");
    expect(db.activities.find((a) => a.id === "r1")?.contactId).toBe("local");
    expect(db.activities.find((a) => a.timestamp === "2026-10-10T12:00:00.000Z" && a.contactId === other.id)).toBeTruthy();
    expect(new Set(db.activities.map((a) => a.id)).size).toBe(db.activities.length);
  });

  it("keeps the current record when it is newer, and is idempotent", () => {
    const current = makeDb([makeContact({ company: "Current", updatedAt: "2026-10-20T00:00:00.000Z" })]);
    current.activities = [act("a1", "c1")];
    const older = makeDb([makeContact({ company: "Older", updatedAt: "2026-10-11T00:00:00.000Z" })]);
    older.activities = [act("a1", "c1")];
    const first = planImport(current, parse(older), "merge");
    expect(first.db.contacts[0]!.company).toBe("Current");
    expect(first.summary.contactsKept).toBe(1);
    expect(first.summary.activitiesAdded).toBe(0);
    const again = planImport(first.db, parse(older), "merge");
    expect(again.db.contacts).toHaveLength(1);
    expect(again.db.activities).toHaveLength(1);
  });

  it("keeps settings on merge, uses backup settings on replace, and fixes template references", () => {
    const current = makeDb([makeContact({ id: "x", normalizedProfileUrl: "https://www.linkedin.com/in/x" })]);
    current.settings.myName = "Local Me";
    const incoming = makeDb([makeContact()]);
    incoming.settings.myName = "Backup Me";
    incoming.templates = incoming.templates.filter((t) => t.id !== "starter-recruiter");
    const merged = planImport(current, parse(incoming), "merge");
    expect(merged.db.settings.myName).toBe("Local Me");

    const target = makeDb([]);
    const summary = applyImport(target, parse(incoming), "replace");
    expect(target.settings.myName).toBe("Backup Me");
    expect(target.settings.defaultTemplateByCategory.RECRUITER).toBeNull();
    expect(target.contacts).toHaveLength(1);
    expect(summary.contactsAdded).toBe(1);

    const replacing = planImport(current, parse(incoming), "replace");
    expect(replacing.summary.contactsRemoved).toBe(1);
  });
});

describe("legacy backups", () => {
  it("accepts backups made under the old LinkedMaven Connect name", () => {
    const legacy = JSON.parse(JSON.stringify(createBackup(makeDb([makeContact()]), NOW)));
    legacy.format = "linkedmaven-connect-backup";
    const r = parseBackup(JSON.stringify(legacy));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup.format).toBe("linkedconnect-backup");
  });
});
