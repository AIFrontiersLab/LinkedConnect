import { useEffect, useId, useState, type ChangeEvent } from "react";
import type { Settings, ThemePreference } from "../shared/types";
import { updateSettings } from "../shared/actions";
import { applyImport, backupFileName, createBackup, parseBackup, planImport, type BackupFile, type ImportMode, type ImportSummary } from "../shared/backup";
import { contactsToCsv, csvFileName } from "../shared/csv";
import { loadDemoData, removeDemoData } from "../shared/demo";
import { DB_KEY } from "../shared/storage";
import { browserTimeZone, supportedTimeZones, todayInZone } from "../shared/time";
import { hasNotificationPermission, removeNotificationPermission, requestNotificationPermission } from "../shared/navigation";
import { downloadFile } from "../ui/clipboard";
import { Dialog, Field, Icon } from "../ui/components";
import { useDatabase, useToast } from "../ui/hooks";

export function SettingsView() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1>Settings</h1>
      <div className="settings-grid">
        <IdentitySettings />
        <PreferenceSettings />
        <ReminderSettings />
        <BackupSettings />
        <DemoSettings />
        <StorageInfo />
      </div>
    </div>
  );
}

function IdentitySettings() {
  const { db, run, readOnlyReason } = useDatabase();
  const id = useId();
  const s = db!.settings;
  const [form, setForm] = useState({ myName: s.myName, myTitle: s.myTitle, myCompany: s.myCompany, communityUrl: s.communityUrl });
  useEffect(() => setForm({ myName: s.myName, myTitle: s.myTitle, myCompany: s.myCompany, communityUrl: s.communityUrl }), [s.myName, s.myTitle, s.myCompany, s.communityUrl]);
  const dirty = form.myName !== s.myName || form.myTitle !== s.myTitle || form.myCompany !== s.myCompany || form.communityUrl !== s.communityUrl;
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <section className="card stack" aria-labelledby={`${id}-h`}>
      <div className="stack-sm">
        <h3 id={`${id}-h`}>Your details</h3>
        <p className="small muted">Used for {"{{myName}}"}, {"{{myTitle}}"}, {"{{myCompany}}"} and {"{{communityUrl}}"} in templates. Stored only in this browser.</p>
      </div>
      <Field label="Your name" htmlFor={`${id}-name`}>
        <input id={`${id}-name`} type="text" value={form.myName} onChange={set("myName")} maxLength={200} autoComplete="name" />
      </Field>
      <Field label="Your title" htmlFor={`${id}-title`}>
        <input id={`${id}-title`} type="text" value={form.myTitle} onChange={set("myTitle")} maxLength={200} autoComplete="organization-title" />
      </Field>
      <Field label="Your company" htmlFor={`${id}-company`}>
        <input id={`${id}-company`} type="text" value={form.myCompany} onChange={set("myCompany")} maxLength={200} autoComplete="organization" />
      </Field>
      <Field label="Community URL" htmlFor={`${id}-url`} hint="For example, the page for your AI Frontiers community.">
        <input id={`${id}-url`} type="url" value={form.communityUrl} onChange={set("communityUrl")} placeholder="https://" />
      </Field>
      <div>
        <button type="button" className="btn btn-primary" disabled={!dirty || !!readOnlyReason} onClick={() => void run((d) => updateSettings(d, form), "Your details were saved.")}>
          Save details
        </button>
      </div>
    </section>
  );
}

function PreferenceSettings() {
  const { db, run, readOnlyReason } = useDatabase();
  const id = useId();
  const s = db!.settings;
  const zones = supportedTimeZones();
  const [days, setDays] = useState(String(s.defaultFollowUpDays));
  useEffect(() => setDays(String(s.defaultFollowUpDays)), [s.defaultFollowUpDays]);
  const save = (patch: Partial<Settings>, msg = "Preferences saved.") => void run((d) => updateSettings(d, patch), msg);
  const ro = !!readOnlyReason;
  return (
    <section className="card stack" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Preferences</h3>
      <Field label="Timezone" htmlFor={`${id}-tz`} hint="Dates and times are shown and entered in this timezone.">
        <select id={`${id}-tz`} value={s.timeZone} onChange={(e) => save({ timeZone: e.target.value })} disabled={ro}>
          <option value="">Browser default ({browserTimeZone()})</option>
          {(zones.length ? zones : [browserTimeZone(), "UTC"]).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Theme" htmlFor={`${id}-theme`}>
        <select id={`${id}-theme`} value={s.theme} onChange={(e) => save({ theme: e.target.value as ThemePreference })} disabled={ro}>
          <option value="system">Match system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
      <Field label="Default follow-up after a message (days)" htmlFor={`${id}-days`}>
        <div className="row">
          <input id={`${id}-days`} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 100 }} disabled={ro} />
          <button type="button" className="btn btn-sm" disabled={ro || days === String(s.defaultFollowUpDays)} onClick={() => save({ defaultFollowUpDays: Number(days) })}>
            Save
          </button>
        </div>
      </Field>
    </section>
  );
}

function ReminderSettings() {
  const { db, run, readOnlyReason } = useDatabase();
  const { notify } = useToast();
  const id = useId();
  const enabled = db!.settings.desktopReminders;
  const [permission, setPermission] = useState<boolean | null>(null);
  useEffect(() => {
    void hasNotificationPermission().then(setPermission);
  }, [enabled]);

  async function toggle(on: boolean) {
    if (on) {
      // Must be called directly from the click so Chrome shows the permission prompt.
      const granted = await requestNotificationPermission();
      setPermission(granted);
      if (!granted) {
        notify("Desktop notifications weren't allowed. The dashboard and toolbar badge still show what's due.", "error");
        return;
      }
      await run((d) => updateSettings(d, { desktopReminders: true }), "Desktop reminders on.");
      chrome.runtime.sendMessage({ type: "reconcile" }).catch(() => undefined);
    } else {
      await run((d) => updateSettings(d, { desktopReminders: false }), "Desktop reminders off.");
      await removeNotificationPermission();
      setPermission(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Reminders</h3>
      <label className="checkbox">
        <input type="checkbox" checked={enabled && permission !== false} onChange={(e) => void toggle(e.target.checked)} disabled={!!readOnlyReason} />
        Show desktop notifications when follow-ups are due
      </label>
      {enabled && permission === false && (
        <div className="notice notice-warning">Notifications are turned on here but Chrome's permission is missing. Toggle the setting to grant it again.</div>
      )}
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>The toolbar badge counts contacts that need action: accepted with no first message, or a follow-up that's due. Each person counts once.</li>
        <li>You get one notification per reminder; several at once are combined into a single summary.</li>
        <li>
          Reminders can't appear while Chrome is fully closed. Anything that came due in the meantime is shown the next time Chrome starts.
        </li>
        <li>Notifications are optional; the dashboard and badge work without them.</li>
      </ul>
    </section>
  );
}

function BackupSettings() {
  const { db, run, tz, readOnlyReason } = useDatabase();
  const id = useId();
  const [parsed, setParsed] = useState<{ backup: BackupFile; fileName: string } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const now = new Date();
  const today = todayInZone(tz, now);
  const preview: ImportSummary | null = parsed && db ? planImport(db, parsed.backup, mode).summary : null;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setParsed(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const r = parseBackup(await file.text());
      if (r.ok) {
        setParsed({ backup: r.backup, fileName: file.name });
        setMode("merge");
        setConfirmReplace(false);
      } else setParseError(r.error);
    } catch {
      setParseError("The file couldn't be read.");
    }
  }

  async function doImport() {
    if (!parsed) return;
    const r = await run(
      (d) => applyImport(d, parsed.backup, mode),
      (s) =>
        mode === "replace"
          ? `Data replaced: ${s.contactsAdded} contacts restored.`
          : `Merged: ${s.contactsAdded} added, ${s.contactsUpdated} updated, ${s.contactsKept} unchanged.`,
    );
    if (r.ok) setParsed(null);
  }

  return (
    <section className="card stack" aria-labelledby={`${id}-h`}>
      <div className="stack-sm">
        <h3 id={`${id}-h`}>Export &amp; backup</h3>
        <p className="small muted">
          CSV is a snapshot for Excel or Sheets; it doesn't stay in sync. A JSON backup includes contacts, history, templates and settings
          and can be restored here.
        </p>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => downloadFile(csvFileName(today), contactsToCsv(db!.contacts, tz, now), "text/csv;charset=utf-8")}
          disabled={db!.contacts.length === 0}
        >
          <Icon name="download" /> Export all contacts (CSV)
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => downloadFile(backupFileName(today), JSON.stringify(createBackup(db!, now), null, 2), "application/json")}
        >
          <Icon name="download" /> Download backup (JSON)
        </button>
      </div>
      <div className="field">
        <label htmlFor={`${id}-file`}>Restore from backup</label>
        <input id={`${id}-file`} type="file" accept="application/json,.json" onChange={(e) => void onFile(e)} disabled={!!readOnlyReason} />
        <span className="hint">Nothing changes until you review the preview and confirm.</span>
      </div>
      {parseError && (
        <div className="notice notice-error" role="alert">
          Backup rejected: {parseError} Your existing data was not changed.
        </div>
      )}

      <Dialog open={!!parsed} onClose={() => setParsed(null)} title="Restore backup" description={parsed ? `${parsed.fileName}, exported ${new Date(parsed.backup.exportedAt).toLocaleString()}` : undefined}>
        {parsed && preview && (
          <div className="stack">
            <p>
              The backup contains <strong>{parsed.backup.data.contacts.length}</strong> contacts, <strong>{parsed.backup.data.activities.length}</strong>{" "}
              activity entries and <strong>{parsed.backup.data.templates.length}</strong> templates.
            </p>
            <fieldset className="stack-sm" style={{ border: "none", padding: 0, margin: 0 }}>
              <legend className="label">How should it be restored?</legend>
              <label className="checkbox" style={{ alignItems: "flex-start" }}>
                <input type="radio" name={`${id}-mode`} checked={mode === "merge"} onChange={() => setMode("merge")} />
                <span>
                  <strong>Merge</strong> with current data
                  <span className="small muted" style={{ display: "block" }}>
                    Same profile URL = same person; the more recently updated version wins. History is combined. Your current settings are kept.
                  </span>
                </span>
              </label>
              <label className="checkbox" style={{ alignItems: "flex-start" }}>
                <input type="radio" name={`${id}-mode`} checked={mode === "replace"} onChange={() => setMode("replace")} />
                <span>
                  <strong>Replace</strong> everything
                  <span className="small muted" style={{ display: "block" }}>
                    Current contacts, history, templates and settings are replaced by the backup.
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="notice notice-info small">
              {mode === "merge" ? (
                <>
                  Result: {preview.contactsAdded} contacts added, {preview.contactsUpdated} updated from the backup, {preview.contactsKept} kept as is;{" "}
                  {preview.activitiesAdded} activity entries and {preview.templatesAdded + preview.templatesUpdated} templates added or updated.
                </>
              ) : (
                <>
                  Result: {db!.contacts.length} current contacts replaced by {preview.contactsAdded}.{" "}
                  {preview.contactsRemoved > 0 && <strong>{preview.contactsRemoved} contacts not in the backup will be removed.</strong>}
                </>
              )}
            </div>
            {mode === "replace" && (
              <label className="checkbox">
                <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
                I understand my current data will be replaced. (Download a backup first if unsure.)
              </label>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setParsed(null)}>
                Cancel
              </button>
              <button type="button" className={`btn ${mode === "replace" ? "btn-danger" : "btn-primary"}`} onClick={() => void doImport()} disabled={mode === "replace" && !confirmReplace}>
                <Icon name="upload" /> {mode === "replace" ? "Replace my data" : "Merge backup"}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

function DemoSettings() {
  const { db, run, readOnlyReason } = useDatabase();
  const id = useId();
  const demoCount = db!.contacts.filter((c) => c.isDemo).length;
  return (
    <section className="card stack" aria-labelledby={`${id}-h`}>
      <div className="stack-sm">
        <h3 id={`${id}-h`}>Demo data (for testing)</h3>
        <p className="small muted">
          Adds a few clearly labeled sample contacts in different states. They're marked “Demo”, use example profile links, and can be
          removed in one click. Nothing is added automatically.
        </p>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={!!readOnlyReason}
          onClick={() => void run((d, now) => loadDemoData(d, now), (r) => (r.added ? `Loaded ${r.added} demo contacts.` : "Demo contacts are already loaded."))}
        >
          Load demo data
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={demoCount === 0 || !!readOnlyReason}
          onClick={() => void run((d) => removeDemoData(d), (n) => `Removed ${n} demo contacts.`)}
        >
          Remove demo data{demoCount ? ` (${demoCount})` : ""}
        </button>
      </div>
    </section>
  );
}

function StorageInfo() {
  const { db } = useDatabase();
  const id = useId();
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    chrome.storage.local
      .getBytesInUse(null)
      .then(setBytes)
      .catch(() => setBytes(null));
  }, [db?.revision]);
  const quarantine = db!.quarantine;
  return (
    <section className="card stack" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Data &amp; storage</h3>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        <li>All records are stored locally in this Chrome profile ({DB_KEY}). There is no account, server or sync.</li>
        <li>Data is not copied to other computers or Chrome profiles. Use JSON backups to move or protect it.</li>
        <li>
          <strong>Uninstalling the extension deletes its data.</strong> Download a backup first.
        </li>
        <li>
          Using {bytes === null ? "…" : `${(bytes / 1024).toFixed(1)} KB`} of about 10 MB available. {db!.contacts.length} contacts, {db!.activities.length}{" "}
          activity entries.
        </li>
      </ul>
      {quarantine.length > 0 && (
        <div className="notice notice-warning stack-sm">
          <span>
            {quarantine.length} stored record{quarantine.length === 1 ? " was" : "s were"} invalid and set aside rather than deleted.
          </span>
          <div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => downloadFile("linkedconnect-quarantine.json", JSON.stringify(quarantine, null, 2), "application/json")}
            >
              Download set-aside records
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
