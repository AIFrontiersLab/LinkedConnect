import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Database, ThemePreference } from "../shared/types";
import { getRepository, subscribeToDatabase } from "../shared/storage";
import { DuplicateContactError, ValidationError } from "../shared/actions";
import { resolveTimeZone } from "../shared/time";

// ---------- Toasts ----------

type ToastKind = "info" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  notify(message: string, kind?: ToastKind): void;
}

const ToastContext = createContext<ToastApi>({ notify: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      // Errors stay until dismissed so they aren't missed.
      if (kind === "info") setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "toast-error" : ""}`} role={t.kind === "error" ? "alert" : undefined}>
            <span className="pre-wrap">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function errorMessage(err: unknown): string {
  if (err instanceof ValidationError || err instanceof DuplicateContactError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------- Database ----------

export type RunResult<T> = { ok: true; result: T; db: Database } | { ok: false; error: unknown };

export interface DatabaseState {
  db: Database | null;
  loadError: string | null;
  readOnlyReason: string | null;
  notes: string[];
  tz: string;
  /** Applies a mutation through the shared, locked data layer; errors are shown as toasts. */
  run<T>(fn: (db: Database, now: Date) => T, success?: string | ((result: T) => string), opts?: { silentErrors?: boolean }): Promise<RunResult<T>>;
  reload(): Promise<void>;
}

const DatabaseContext = createContext<DatabaseState | null>(null);

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const repo = getRepository();
  const { notify } = useToast();
  const [db, setDb] = useState<Database | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readOnlyReason, setReadOnly] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const latestRevision = useRef(-1);

  const accept = useCallback((next: Database, force = false) => {
    // Ignore stale reads that resolve after a newer write.
    if (!force && next.revision < latestRevision.current) return false;
    latestRevision.current = next.revision;
    setDb(next);
    return true;
  }, []);

  const reload = useCallback(async () => {
    try {
      let r = await repo.load();
      if (!accept(r.db)) {
        // Either a stale read or storage was reset externally; a fresh read settles it.
        r = await repo.load();
        accept(r.db, true);
      }
      setReadOnly(r.readOnlyReason);
      setNotes(r.notes);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [repo, accept]);

  useEffect(() => {
    void reload();
    const unsubscribe = subscribeToDatabase(() => void reload());
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  const run = useCallback<DatabaseState["run"]>(
    async (fn, success, opts) => {
      try {
        const { db: next, result } = await repo.mutate(fn);
        accept(next);
        if (success) notify(typeof success === "function" ? success(result) : success);
        return { ok: true, result, db: next };
      } catch (err) {
        if (!opts?.silentErrors) notify(errorMessage(err), "error");
        // Refresh so the UI reflects what is actually stored.
        void reload();
        return { ok: false, error: err };
      }
    },
    [repo, accept, notify, reload],
  );

  const value = useMemo<DatabaseState>(
    () => ({ db, loadError, readOnlyReason, notes, tz: resolveTimeZone(db?.settings.timeZone), run, reload }),
    [db, loadError, readOnlyReason, notes, run, reload],
  );
  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseState {
  const ctx = useContext(DatabaseContext);
  if (!ctx) throw new Error("useDatabase must be used inside DatabaseProvider");
  return ctx;
}

/** Re-renders periodically so "due" states stay current while a page is open (display only). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    const onVisible = () => document.visibilityState === "visible" && setNow(new Date());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
  return now;
}

export function useTheme(pref: ThemePreference | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (!pref || pref === "system") delete root.dataset.theme;
    else root.dataset.theme = pref;
  }, [pref]);
}
