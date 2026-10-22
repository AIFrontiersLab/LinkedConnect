// Shared typed data layer. Every write goes through `mutate`, which:
//   1. takes a cross-context lock (Web Locks API: shared by popup, dashboard and service worker),
//   2. re-reads the latest stored document (never a stale UI copy),
//   3. applies the change to a copy and bumps `revision`,
//   4. writes the whole document in a single storage call (all-or-nothing).
// If the callback throws or the write fails, stored data is unchanged and the error propagates.

import type { Database, Draft } from "./types";
import { CorruptDataError, FutureSchemaError, createEmptyDatabase, migrateDatabase } from "./schema";

export const DB_KEY = "lmc:db";
export const DRAFTS_KEY = "lmc:drafts";
const LOCK_NAME = "linkedmaven-connect-db";

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type Locker = <T>(fn: () => Promise<T>) => Promise<T>;

export class StorageWriteError extends Error {
  override name = "StorageWriteError";
}

export function chromeLocalStore(): KeyValueStore {
  return {
    async get(key) {
      const out = await chrome.storage.local.get(key);
      return out[key];
    },
    async set(items) {
      await chrome.storage.local.set(items);
    },
  };
}

/** In-process queue; used when the Web Locks API is unavailable (e.g. tests). */
export function queueLocker(): Locker {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function defaultLocker(): Locker {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks?.request) return <T>(fn: () => Promise<T>) => locks.request(LOCK_NAME, fn) as Promise<T>;
  return queueLocker();
}

function friendlyWriteError(err: unknown): StorageWriteError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/quota/i.test(msg)) {
    return new StorageWriteError(
      "Chrome's local storage for this extension is full, so the change was not saved. Export a backup, then archive or delete old contacts.",
    );
  }
  return new StorageWriteError(`The change could not be saved: ${msg}`);
}

export interface LoadResult {
  db: Database;
  /** Set when data can't be written safely (e.g. created by a newer version). */
  readOnlyReason: string | null;
  notes: string[];
}

export interface Repository {
  load(): Promise<LoadResult>;
  mutate<T>(fn: (db: Database, now: Date) => T): Promise<{ db: Database; result: T }>;
  loadDrafts(): Promise<Record<string, Draft>>;
  saveDraft(draft: Draft): Promise<void>;
  clearDraft(contactId: string): Promise<void>;
}

export function createRepository(
  store: KeyValueStore,
  lock: Locker = defaultLocker(),
  clock: () => Date = () => new Date(),
): Repository {
  /** Reads + migrates. Corrupt documents are preserved under a backup key before starting fresh. */
  async function readCurrent(now: Date, allowRepair: boolean): Promise<LoadResult & { changed: boolean }> {
    const raw = await store.get(DB_KEY);
    try {
      const m = migrateDatabase(raw, now.toISOString());
      return { db: m.db, changed: m.changed, notes: m.notes, readOnlyReason: null };
    } catch (err) {
      if (err instanceof FutureSchemaError) throw err;
      if (err instanceof CorruptDataError) {
        const backupKey = `lmc:corrupt-backup:${now.toISOString()}`;
        if (allowRepair) await store.set({ [backupKey]: raw });
        const db = createEmptyDatabase(now.toISOString());
        db.quarantine.push({ kind: "database", reason: err.message, backupKey, quarantinedAt: now.toISOString() });
        return { db, changed: true, notes: [`Stored data was unreadable and was preserved under "${backupKey}".`], readOnlyReason: null };
      }
      throw err;
    }
  }

  return {
    async load() {
      try {
        const r = await readCurrent(clock(), false);
        return { db: r.db, notes: r.notes, readOnlyReason: null };
      } catch (err) {
        if (err instanceof FutureSchemaError) {
          return { db: createEmptyDatabase(clock().toISOString()), notes: [], readOnlyReason: err.message };
        }
        throw err;
      }
    },

    mutate(fn) {
      return lock(async () => {
        const now = clock();
        const { db } = await readCurrent(now, true);
        const draft = structuredClone(db);
        const result = fn(draft, now);
        draft.revision = db.revision + 1;
        try {
          await store.set({ [DB_KEY]: draft });
        } catch (err) {
          throw friendlyWriteError(err);
        }
        return { db: draft, result };
      });
    },

    async loadDrafts() {
      const raw = await store.get(DRAFTS_KEY);
      return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, Draft>) : {};
    },

    async saveDraft(draft) {
      await lock(async () => {
        const raw = await store.get(DRAFTS_KEY);
        const drafts = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, Draft>) } : {};
        drafts[draft.contactId] = draft;
        try {
          await store.set({ [DRAFTS_KEY]: drafts });
        } catch (err) {
          throw friendlyWriteError(err);
        }
      });
    },

    async clearDraft(contactId) {
      await lock(async () => {
        const raw = await store.get(DRAFTS_KEY);
        if (!raw || typeof raw !== "object" || !(contactId in (raw as object))) return;
        const drafts = { ...(raw as Record<string, Draft>) };
        delete drafts[contactId];
        await store.set({ [DRAFTS_KEY]: drafts });
      });
    },
  };
}

/** Repository for extension pages and the service worker. */
let shared: Repository | null = null;
export function getRepository(): Repository {
  shared ??= createRepository(chromeLocalStore());
  return shared;
}

/** Calls `onChange` whenever the database is written by any context. Returns an unsubscribe fn. */
export function subscribeToDatabase(onChange: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && DB_KEY in changes) onChange();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
