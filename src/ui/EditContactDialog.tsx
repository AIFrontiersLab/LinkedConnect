import { useId, useState, type FormEvent } from "react";
import type { Category, Contact } from "../shared/types";
import { CATEGORIES, CATEGORY_LABELS } from "../shared/types";
import { updateContact, type ContactPatch } from "../shared/actions";
import { fromZonedInputValue, todayInZone, toZonedInputValue } from "../shared/time";
import { firstNameOf } from "../shared/templates";
import { Dialog, Field } from "./components";
import { errorMessage, useDatabase } from "./hooks";

type StageKey = "acceptedAt" | "initialMessageSentAt" | "lastMessageSentAt" | "repliedAt";
const STAGE_LABELS: Record<StageKey, string> = {
  acceptedAt: "Accepted on",
  initialMessageSentAt: "First message sent",
  lastMessageSentAt: "Last message sent",
  repliedAt: "Replied on",
};

export function EditContactDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { run, tz } = useDatabase();
  const id = useId();
  const [form, setForm] = useState({
    profileUrl: contact.profileUrl || contact.normalizedProfileUrl,
    fullName: contact.fullName,
    firstNameOverride: contact.firstNameOverride,
    company: contact.company,
    role: contact.role,
    category: contact.category,
    connectionReason: contact.connectionReason,
    priority: contact.priority,
    requestSentAt: contact.requestSentAt,
  });
  const [stages, setStages] = useState<Record<StageKey, string>>({
    acceptedAt: toZonedInputValue(contact.acceptedAt, tz),
    initialMessageSentAt: toZonedInputValue(contact.initialMessageSentAt, tz),
    lastMessageSentAt: toZonedInputValue(contact.lastMessageSentAt, tz),
    repliedAt: toZonedInputValue(contact.repliedAt, tz),
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const patch: ContactPatch = { ...form };
    if (form.profileUrl.trim() === (contact.profileUrl || contact.normalizedProfileUrl)) delete patch.profileUrl;
    for (const key of Object.keys(stages) as StageKey[]) {
      if (!contact[key]) continue;
      const iso = fromZonedInputValue(stages[key], tz);
      if (!iso) {
        setError(`${STAGE_LABELS[key]} needs a valid date and time.`);
        return;
      }
      // Keep the stored precision unless the minute shown was actually changed.
      if (toZonedInputValue(contact[key], tz) !== stages[key]) patch[key] = iso;
    }
    const r = await run((d, now) => updateContact(d, contact.id, patch, now), "Contact updated.", { silentErrors: true });
    if (r.ok) onClose();
    else setError(errorMessage(r.error));
  }

  const fid = (k: string) => `${id}-${k}`;
  const presentStages = (Object.keys(stages) as StageKey[]).filter((k) => contact[k]);

  return (
    <Dialog open onClose={onClose} title={`Edit ${contact.fullName}`} className="wide">
      <form className="stack" onSubmit={submit} noValidate>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <Field label="LinkedIn profile URL" required htmlFor={fid("url")}>
          <input id={fid("url")} type="url" value={form.profileUrl} onChange={(e) => set("profileUrl", e.target.value)} spellCheck={false} />
        </Field>
        <div className="grid-2">
          <Field label="Full name" required htmlFor={fid("name")}>
            <input id={fid("name")} type="text" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} maxLength={200} />
          </Field>
          <Field
            label="First name for messages"
            htmlFor={fid("first")}
            hint={`Leave blank to use “${firstNameOf({ fullName: form.fullName, firstNameOverride: "" })}”.`}
          >
            <input id={fid("first")} type="text" value={form.firstNameOverride} onChange={(e) => set("firstNameOverride", e.target.value)} maxLength={100} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Company" htmlFor={fid("company")}>
            <input id={fid("company")} type="text" value={form.company} onChange={(e) => set("company", e.target.value)} maxLength={200} />
          </Field>
          <Field label="Role / title" htmlFor={fid("role")}>
            <input id={fid("role")} type="text" value={form.role} onChange={(e) => set("role", e.target.value)} maxLength={200} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Category" required htmlFor={fid("cat")}>
            <select id={fid("cat")} value={form.category} onChange={(e) => set("category", e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Request sent" required htmlFor={fid("req")}>
            <input id={fid("req")} type="date" max={todayInZone(tz)} value={form.requestSentAt} onChange={(e) => set("requestSentAt", e.target.value)} />
          </Field>
        </div>
        <Field label="Why I connected" htmlFor={fid("reason")}>
          <textarea id={fid("reason")} rows={2} style={{ minHeight: 56 }} value={form.connectionReason} onChange={(e) => set("connectionReason", e.target.value)} maxLength={2000} />
        </Field>
        {presentStages.length > 0 && (
          <fieldset className="stack-sm" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <legend className="label">Recorded dates ({tz})</legend>
            <p className="small muted">Correct dates here. To undo a status, use “Correct status” instead.</p>
            <div className="grid-2">
              {presentStages.map((k) => (
                <Field key={k} label={STAGE_LABELS[k]} htmlFor={fid(k)}>
                  <input id={fid(k)} type="datetime-local" value={stages[k]} onChange={(e) => setStages((s) => ({ ...s, [k]: e.target.value }))} />
                </Field>
              ))}
            </div>
          </fieldset>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={form.priority} onChange={(e) => set("priority", e.target.checked)} />
          Priority (starred)
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save changes
          </button>
        </div>
      </form>
    </Dialog>
  );
}
