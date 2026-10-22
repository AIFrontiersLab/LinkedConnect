import { describe, expect, it } from "vitest";
import { createRepository, DB_KEY, queueLocker, type KeyValueStore } from "../src/shared/storage";
import { addContact, applyTransition, DuplicateContactError } from "../src/shared/actions";
import { markAccepted } from "../src/shared/lifecycle";
import { migrateDatabase, FutureSchemaError } from "../src/shared/schema";
import { NOW, makeContact } from "./helpers";

function memoryStore(initial: Record<string, unknown> = {}, opts: { failWrites?: boolean } = {}): KeyValueStore & { data: Record<string, unknown> } {
  const data = structuredClone(initial);
  return {
    data,
    async get(key) {
      await new Promise((r) => setTimeout(r, Math.random() * 3));
      return structuredClone(data[key]);
    },
    async set(items) {
      await new Promise((r) => setTimeout(r, Math.random() * 3));
      if (opts.failWrites) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(data, structuredClone(items));
    },
  };
}

const input = (slug: string) => ({ profileUrl: `linkedin.com/in/${slug}`, fullName: slug, category: "OTHER" as const, requestSentAt: "2026-10-20" });

describe("repository", () => {
  it("serializes concurrent mutations without losing updates", async () => {
    const store = memoryStore();
    // Two repositories sharing one lock simulate the popup and dashboard.
    const lock = queueLocker();
    const popup = createRepository(store, lock, () => NOW);
    const dashboard = createRepository(store, lock, () => NOW);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? popup : dashboard).mutate((db, now) => addContact(db, input(`person-${i}`), now))),
    );
    const { db } = await popup.load();
    expect(db.contacts).toHaveLength(20);
    expect(db.revision).toBe(20);
  });

  it("rejects duplicate saves even when submitted twice concurrently", async () => {
    const repo = createRepository(memoryStore(), queueLocker(), () => NOW);
    const results = await Promise.allSettled([
      repo.mutate((db, now) => addContact(db, input("same"), now)),
      repo.mutate((db, now) => addContact(db, input("SAME"), now)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DuplicateContactError);
    expect((await repo.load()).db.contacts).toHaveLength(1);
  });

  it("leaves stored data unchanged when the callback throws or the write fails", async () => {
    const store = memoryStore();
    const repo = createRepository(store, queueLocker(), () => NOW);
    const { result: c } = await repo.mutate((db, now) => addContact(db, input("keep"), now));
    const before = JSON.stringify(store.data[DB_KEY]);
    await expect(
      repo.mutate((db, now) => applyTransition(db, c.id, (x, n, tz) => markAccepted(x, "2020-01-01T00:00:00.000Z", n, tz), now)),
    ).rejects.toThrow();
    expect(JSON.stringify(store.data[DB_KEY])).toBe(before);

    const failing = memoryStore(store.data, { failWrites: true });
    const repo2 = createRepository(failing, queueLocker(), () => NOW);
    await expect(repo2.mutate((db, now) => addContact(db, input("new"), now))).rejects.toThrow(/storage .* full/);
    expect(JSON.stringify(failing.data[DB_KEY])).toBe(before);
  });

  it("preserves unreadable data under a backup key instead of discarding it", async () => {
    const store = memoryStore({ [DB_KEY]: "garbage" });
    const repo = createRepository(store, queueLocker(), () => NOW);
    await repo.mutate(() => undefined);
    const backupKey = Object.keys(store.data).find((k) => k.startsWith("lmc:corrupt-backup:"));
    expect(backupKey && store.data[backupKey]).toBe("garbage");
  });

  it("refuses to write data from a newer schema version", async () => {
    const store = memoryStore({ [DB_KEY]: { schemaVersion: 99 } });
    const repo = createRepository(store, queueLocker(), () => NOW);
    expect((await repo.load()).readOnlyReason).toMatch(/newer/);
    await expect(repo.mutate(() => undefined)).rejects.toBeInstanceOf(FutureSchemaError);
  });
});

describe("migration", () => {
  it("creates an empty database with starter templates and no contacts", () => {
    const { db } = migrateDatabase(undefined, NOW.toISOString());
    expect(db.contacts).toEqual([]);
    expect(db.templates.length).toBeGreaterThanOrEqual(6);
  });

  it("upgrades unversioned data and quarantines invalid records instead of dropping them", () => {
    const good = makeContact();
    const { db, notes } = migrateDatabase(
      {
        contacts: [good, { id: "bad" }, { ...good, id: "dup" }],
        activities: [{ id: "a", contactId: "c1", activityType: "CREATED", timestamp: NOW.toISOString() }, { nope: true }],
      },
      NOW.toISOString(),
    );
    expect(db.schemaVersion).toBe(1);
    expect(db.contacts.map((c) => c.id)).toEqual(["c1"]);
    expect(db.activities).toHaveLength(1);
    expect(db.quarantine).toHaveLength(3);
    expect(notes).toHaveLength(3);
  });

  it("repairs a stored status that disagrees with timestamps", () => {
    const { db } = migrateDatabase(
      { schemaVersion: 1, contacts: [makeContact({ lifecycleStatus: "REPLIED" })] },
      NOW.toISOString(),
    );
    expect(db.contacts[0]!.lifecycleStatus).toBe("REQUEST_SENT");
  });
});
